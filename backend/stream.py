"""Real-time NetFlow streaming and preprocessing."""

import logging
from collections import deque
from typing import Dict, List, Tuple, Optional
import hashlib
import time as _time
import numpy as np
import torch

from models import NetFlowRecord, ClassificationResult

logger = logging.getLogger(__name__)


def _score_to_severity(score: float) -> str:
    """Map anomaly score to a human-readable severity tier."""
    if score >= 0.90:
        return "critical"
    if score >= 0.70:
        return "high"
    if score >= 0.50:
        return "medium"
    return "low"


class RealtimeNodeMapping:
    """Manages node ID mapping for incoming IPs."""
    
    def __init__(self, max_nodes: int = 100000, unknown_node_id: int = 999999):
        self.max_nodes = max_nodes
        self.unknown_node_id = unknown_node_id
        self.ip_to_id: Dict[str, int] = {}
        self.id_to_ip: Dict[int, str] = {}
        self.next_id = 0
    
    def get_or_create_id(self, ip: str) -> int:
        """Get node ID for IP, creating one if necessary."""
        if ip in self.ip_to_id:
            return self.ip_to_id[ip]
        
        if len(self.ip_to_id) >= self.max_nodes:
            logger.warning(f"Max nodes ({self.max_nodes}) exceeded; using unknown node ID")
            return self.unknown_node_id
        
        node_id = self.next_id
        self.ip_to_id[ip] = node_id
        self.id_to_ip[node_id] = ip
        self.next_id += 1
        
        return node_id
    
    def get_size(self) -> int:
        """Get current number of mapped IPs."""
        return len(self.ip_to_id)


class RealtimeFlowBuffer:
    """Maintains a rolling buffer of flow embeddings for windowing."""
    
    def __init__(self, buffer_size: int = 1000, window_size: int = 512, step_percent: float = 0.5):
        self.buffer_size = buffer_size
        self.window_size = window_size
        self.step_size = max(1, int(window_size * step_percent))
        
        self.embeddings = deque(maxlen=buffer_size)
        self.flow_metadata = deque(maxlen=buffer_size)
    
    def add_embedding(
        self,
        embedding: np.ndarray,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        src_port: int,
        dst_port: int,
        timestamp: float,
        ground_truth_label: Optional[int] = None,
        protocol: int = 6,
        bytes_transferred: int = 0,
        packets: int = 0,
        duration_ms: float = 0.0,
    ):
        """Add an edge embedding to the buffer."""
        self.embeddings.append(embedding)
        self.flow_metadata.append({
            "flow_id": flow_id,
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "src_port": src_port,
            "dst_port": dst_port,
            "timestamp": timestamp,
            "ground_truth_label": ground_truth_label,
            "protocol": protocol,
            "bytes": bytes_transferred,
            "packets": packets,
            "duration_ms": duration_ms,
        })
    
    def get_windows_for_batch(self) -> Tuple[List[np.ndarray], List[Tuple[int, int]]]:
        """Get sequences ready for inference using sliding window."""
        if len(self.embeddings) < self.window_size:
            return [], []
        
        windows = []
        indices = []
        
        num_full_windows = (len(self.embeddings) - self.window_size) // self.step_size
        
        for i in range(num_full_windows + 1):
            start = i * self.step_size
            end = start + self.window_size
            
            if end > len(self.embeddings):
                break
            
            emb_list = [self.embeddings[j] for j in range(start, end)]
            window = np.stack(emb_list, axis=0)
            windows.append(window)
            indices.append((start, end))
        
        return windows, indices
    
    def clear(self):
        """Clear buffer."""
        self.embeddings.clear()
        self.flow_metadata.clear()
    
    def get_size(self) -> int:
        """Get current buffer size."""
        return len(self.embeddings)


class RealTimePreprocessor:
    """Preprocesses incoming NetFlow records to match training pipeline."""

    def __init__(self, feature_names: Optional[List[str]] = None):
        self.node_mapping = RealtimeNodeMapping()
        self.feature_names: Optional[List[str]] = list(feature_names) if feature_names is not None else None
    
    def preprocess_flow(self, flow: NetFlowRecord) -> dict:
        """Convert NetFlow record to feature vector."""
        src_node = self.node_mapping.get_or_create_id(flow.src_ip)
        dst_node = self.node_mapping.get_or_create_id(flow.dst_ip)

        if self.feature_names is not None and len(self.feature_names) > 0:
            features = np.zeros(len(self.feature_names), dtype=np.float32)

            bytes_in = flow.bytes_in if flow.bytes_in is not None else flow.bytes // 2
            bytes_out = flow.bytes_out if flow.bytes_out is not None else flow.bytes // 2
            pkts_in = flow.packets_in if flow.packets_in is not None else flow.packets // 2
            pkts_out = flow.packets_out if flow.packets_out is not None else flow.packets // 2
            tcp_flags = flow.tcp_flags if flow.tcp_flags is not None else 0

            for i, name in enumerate(self.feature_names):
                val: float = 0.0
                
                if hasattr(flow, 'all_features') and flow.all_features is not None and name in flow.all_features:
                    val = float(flow.all_features[name])
                elif name == "L4_SRC_PORT":
                    val = float(flow.src_port)
                elif name == "L4_DST_PORT":
                    val = float(flow.dst_port)
                elif name == "PROTOCOL":
                    val = float(flow.protocol)
                elif name == "IN_BYTES":
                    val = float(bytes_in)
                elif name == "OUT_BYTES":
                    val = float(bytes_out)
                elif name == "IN_PKTS":
                    val = float(pkts_in)
                elif name == "OUT_PKTS":
                    val = float(pkts_out)
                elif name == "TCP_FLAGS":
                    val = float(tcp_flags)
                elif name == "FLOW_DURATION_MILLISECONDS":
                    val = float(flow.duration_ms)
                elif name == "FLOW_START_MILLISECONDS":
                    val = float(flow.timestamp * 1000.0)
                elif name == "FLOW_END_MILLISECONDS":
                    val = float(flow.timestamp * 1000.0 + flow.duration_ms)

                features[i] = val

            features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        else:
            features = np.array([
                flow.src_port,
                flow.dst_port,
                flow.protocol,
                flow.bytes_in or flow.bytes // 2,
                flow.packets_in or flow.packets // 2,
                flow.bytes_out or flow.bytes // 2,
                flow.packets_out or flow.packets // 2,
                flow.tcp_flags or 0,
                flow.duration_ms,
            ], dtype=np.float32)
            features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        
        return {
            "src_node": src_node,
            "dst_node": dst_node,
            "features": features,
        }
    
    def batch_preprocess(self, flows: List[NetFlowRecord]) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Preprocess a batch of flows."""
        src_nodes = []
        dst_nodes = []
        features_list = []
        
        for flow in flows:
            preprocessed = self.preprocess_flow(flow)
            src_nodes.append(preprocessed["src_node"])
            dst_nodes.append(preprocessed["dst_node"])
            features_list.append(preprocessed["features"])
        
        edge_index = np.array([src_nodes, dst_nodes], dtype=np.int64)

        if features_list:
            edge_attr = np.stack(features_list, axis=0)
        else:
            if self.feature_names is not None and len(self.feature_names) > 0:
                feat_dim = len(self.feature_names)
            else:
                feat_dim = 9
            edge_attr = np.zeros((0, feat_dim), dtype=np.float32)
        
        return edge_index, edge_attr, flows
    
    def get_node_count(self) -> int:
        """Get total unique nodes seen."""
        return self.node_mapping.get_size()


class StreamProcessor:
    """Orchestrates real-time flow processing: preprocess → encode → score → store."""
    
    def __init__(
        self,
        inference_engine,
        window_size: int = 512,
        step_percent: float = 0.5,
        buffer_size: int = 1000,
    ):
        self.inference_engine = inference_engine
        feature_names = None
        scaler = getattr(self.inference_engine, "scaler", None)
        if scaler is not None and hasattr(scaler, "feature_names_in_"):
            feature_names = list(getattr(scaler, "feature_names_in_"))

        self.preprocessor = RealTimePreprocessor(feature_names=feature_names)
        self.buffer = RealtimeFlowBuffer(
            buffer_size=buffer_size,
            window_size=window_size,
            step_percent=step_percent,
        )
        
        # Statistics
        self.total_flows = 0
        self.total_anomalies = 0
        self.total_heartbeats = 0
        self.recent_events = deque(maxlen=500)
        
        # Performance metrics (for labeled datasets)
        self.true_positives = 0
        self.false_positives = 0
        self.true_negatives = 0
        self.false_negatives = 0
        self.has_ground_truth = False

        # Windowed FPR tracking
        self._fpr_window_sec = 300
        self._windowed_events = deque()

        # Alert state
        self._alert_active = False
        self._alert_triggered_at: Optional[float] = None
        self._alert_fpr_value: Optional[float] = None
        self._alert_threshold: Optional[float] = None
        self._alert_history: deque = deque(maxlen=100)
        
        # Configuration
        self.retraining_threshold_fpr: Optional[float] = None
        
        # Accumulate all flows since last emitted heartbeat for window-level
        # ANY-ANOMALY ground-truth attribution.
        self._pending_flows_for_gt: List[dict] = []
    
    def process_flows(self, flows: List[NetFlowRecord]) -> List[ClassificationResult]:
        """End-to-end processing of a flow batch."""
        import time
        start_time = time.time()
        
        try:
            # 1. Preprocess
            edge_index, edge_attr, raw_flows = self.preprocessor.batch_preprocess(flows)
            
            if len(flows) == 0:
                return []
            
            # 2. Scale features
            edge_attr_scaled = self.inference_engine.scale_features(edge_attr)
            
            # 3. Create torch tensors
            edge_index_t = torch.from_numpy(edge_index).to(self.inference_engine.device)
            edge_attr_t = torch.from_numpy(edge_attr_scaled).float().to(self.inference_engine.device)
            
            # 4. Encode edges
            max_node_id = int(max(edge_index[0].max(), edge_index[1].max())) + 1
            edge_emb = self.inference_engine.encode_edges(
                edge_index_t,
                edge_attr_t,
                num_nodes=max_node_id,
            )
            
            # 5. Add to buffer
            for i, (flow, emb) in enumerate(zip(raw_flows, edge_emb)):
                flow_id = self._generate_flow_id(flow)
                self.buffer.add_embedding(
                    emb.cpu().numpy(),
                    flow_id=flow_id,
                    src_ip=flow.src_ip,
                    dst_ip=flow.dst_ip,
                    src_port=flow.src_port,
                    dst_port=flow.dst_port,
                    timestamp=flow.timestamp,
                    ground_truth_label=flow.ground_truth_label,
                    protocol=flow.protocol,
                    bytes_transferred=flow.bytes,
                    packets=flow.packets,
                    duration_ms=flow.duration_ms,
                )
                self._pending_flows_for_gt.append({
                    "ground_truth_label": flow.ground_truth_label,
                })
                if flow.ground_truth_label is not None:
                    self.has_ground_truth = True
            
            # 6. Get sequences and run inference
            windows, window_indices = self.buffer.get_windows_for_batch()
            results = []
            
            if windows:
                windows_array = np.stack(windows, axis=0)
                windows_t = torch.from_numpy(windows_array).float().to(self.inference_engine.device)
                
                # Reconstruct — captures per_timestep_errors for flow attribution
                _, errors, per_timestep_errors = self.inference_engine.reconstruct_sequence(windows_t)
                
                num_windows = len(windows)
                logger.debug(f"Processed {num_windows} windows")

                node_count = self.preprocessor.get_node_count()
                scores, labels = self.inference_engine.compute_anomaly_score(errors, node_count)
                scores = self.inference_engine.smooth_scores(scores)
                
                # Heartbeat aggregation
                heartbeat_result = self.inference_engine.aggregate_scores(scores, labels)
                
                if heartbeat_result is not None:
                    scores, labels = heartbeat_result
                    agg_score = float(scores[0])
                    agg_label = int(labels[0])
                    window_gt = self._aggregate_window_ground_truth(self._pending_flows_for_gt)
                    self._pending_flows_for_gt = []

                    # Update confusion matrix once per emitted heartbeat using
                    # ANY-ANOMALY ground truth over the full heartbeat window.
                    if window_gt is not None:
                        self.has_ground_truth = True
                        self._update_confusion_matrix(predicted=agg_label, actual=window_gt)
                        self._windowed_events.append((_time.time(), window_gt, agg_label))

                    self.total_heartbeats += 1
                    
                    # Attribute display fields to the most anomalous flow in
                    # the emitted heartbeat window.
                    most_anomalous_flow = self._pick_representative_flow(
                        window_indices,
                        per_timestep_errors,
                    )

                    # Build result fields from attributed flow
                    if most_anomalous_flow is not None:
                        src_ip = most_anomalous_flow["src_ip"]
                        dst_ip = most_anomalous_flow["dst_ip"]
                        src_port = most_anomalous_flow["src_port"]
                        dst_port = most_anomalous_flow["dst_port"]
                        protocol = most_anomalous_flow["protocol"]
                        bytes_val = most_anomalous_flow["bytes"]
                        packets_val = most_anomalous_flow["packets"]
                        duration_val = most_anomalous_flow["duration_ms"]
                        flow_id = most_anomalous_flow["flow_id"]
                    else:
                        src_ip = "N/A"
                        dst_ip = "N/A"
                        src_port = 0
                        dst_port = 0
                        protocol = 0
                        bytes_val = 0
                        packets_val = 0
                        duration_val = 0.0
                        flow_id = f"heartbeat_{int(time.time() * 1000)}"
                    
                    result = ClassificationResult(
                        flow_id=flow_id,
                        timestamp=time.time(),
                        src_ip=src_ip,
                        dst_ip=dst_ip,
                        src_port=src_port,
                        dst_port=dst_port,
                        score=agg_score,
                        label=agg_label,
                        severity=_score_to_severity(agg_score),
                        confidence=abs(agg_score - 0.5) * 2,
                        ground_truth_label=window_gt,
                        window_id=self.total_heartbeats,
                        processing_time_ms=(time.time() - start_time) * 1000,
                        protocol=protocol,
                        bytes=bytes_val,
                        packets=packets_val,
                        duration_ms=duration_val,
                    )
                    results.append(result)
                    self.recent_events.append(result)
                    
                    if agg_label == 1:
                        self.total_anomalies += 1
            
            self.check_and_fire_alert()
            self.total_flows += len(flows)
            return results
        
        except Exception as e:
            logger.error(f"Error processing flows: {e}", exc_info=True)
            return []
    
    def _generate_flow_id(self, flow: NetFlowRecord) -> str:
        """Generate unique flow ID."""
        flow_str = f"{flow.src_ip}:{flow.src_port}-{flow.dst_ip}:{flow.dst_port}:{flow.timestamp}"
        return hashlib.md5(flow_str.encode()).hexdigest()[:12]

    def _aggregate_window_ground_truth(self, window_metadata: List[dict]) -> Optional[int]:
        """ANY-ANOMALY rule: window is anomalous if any flow is anomalous."""
        all_values = [m.get("ground_truth_label") for m in window_metadata]
        labels = [v for v in all_values if v is not None]
        if not labels:
            return None
        return 1 if any(label == 1 for label in labels) else 0

    def _pick_representative_flow(
        self,
        window_indices: List[Tuple[int, int]],
        per_timestep_errors: torch.Tensor,
    ) -> Optional[dict]:
        """Return the flow metadata with the largest per-position error."""
        most_anomalous_flow = None
        most_anomalous_score = -1.0

        for w_idx, (start_idx, end_idx) in enumerate(window_indices):
            window_errors = per_timestep_errors[w_idx].detach().cpu().numpy()
            top_position = int(np.argmax(window_errors))
            buffer_position = start_idx + top_position

            if buffer_position >= len(self.buffer.flow_metadata):
                continue

            position_error = float(window_errors[top_position])
            if position_error > most_anomalous_score:
                most_anomalous_score = position_error
                most_anomalous_flow = self.buffer.flow_metadata[buffer_position]

        return most_anomalous_flow

    def _update_confusion_matrix(self, predicted: int, actual: int) -> None:
        """Update lifetime confusion-matrix counters."""
        if predicted == 1 and actual == 1:
            self.true_positives += 1
        elif predicted == 1 and actual == 0:
            self.false_positives += 1
        elif predicted == 0 and actual == 1:
            self.false_negatives += 1
        elif predicted == 0 and actual == 0:
            self.true_negatives += 1

    def get_windowed_fpr(self) -> float:
        """FPR computed over the last _fpr_window_sec seconds only."""
        cutoff = _time.time() - self._fpr_window_sec
        while self._windowed_events and self._windowed_events[0][0] < cutoff:
            self._windowed_events.popleft()
        fp = sum(1 for _, gt, pred in self._windowed_events if gt == 0 and pred == 1)
        tn = sum(1 for _, gt, pred in self._windowed_events if gt == 0 and pred == 0)
        if fp + tn == 0:
            return 0.0
        return fp / (fp + tn)

    def get_windowed_stats(self) -> dict:
        """Full confusion matrix and derived metrics over the current rolling window."""
        cutoff = _time.time() - self._fpr_window_sec
        events = [
            (gt, pred)
            for t, gt, pred in self._windowed_events
            if t >= cutoff
        ]
        tp = sum(1 for gt, pred in events if gt == 1 and pred == 1)
        fp = sum(1 for gt, pred in events if gt == 0 and pred == 1)
        tn = sum(1 for gt, pred in events if gt == 0 and pred == 0)
        fn = sum(1 for gt, pred in events if gt == 1 and pred == 0)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        f1 = (
            2 * precision * tpr / (precision + tpr)
            if (precision + tpr) > 0 else 0.0
        )
        return {
            "window_sec": self._fpr_window_sec,
            "window_event_count": len(events),
            "tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "fpr": round(fpr, 4),
            "tpr": round(tpr, 4),
            "precision": round(precision, 4),
            "f1": round(f1, 4),
        }

    def check_and_fire_alert(self) -> Optional[dict]:
        """Fire an alert the first time windowed FPR exceeds the threshold."""
        if self.retraining_threshold_fpr is None:
            return None

        windowed_fpr = self.get_windowed_fpr()
        threshold_crossed = windowed_fpr > self.retraining_threshold_fpr

        if threshold_crossed and not self._alert_active:
            self._alert_active = True
            self._alert_triggered_at = _time.time()
            self._alert_fpr_value = windowed_fpr
            self._alert_threshold = self.retraining_threshold_fpr

            alert = {
                "alert_id": f"alert_{int(self._alert_triggered_at * 1000)}",
                "triggered_at": self._alert_triggered_at,
                "windowed_fpr": round(windowed_fpr, 4),
                "threshold": self.retraining_threshold_fpr,
                "window_sec": self._fpr_window_sec,
                "windowed_stats": self.get_windowed_stats(),
                "cumulative_stats": {
                    "tp": self.true_positives,
                    "fp": self.false_positives,
                    "tn": self.true_negatives,
                    "fn": self.false_negatives,
                },
                "message": (
                    f"Windowed FPR {windowed_fpr:.2%} exceeded threshold "
                    f"{self.retraining_threshold_fpr:.2%} over the last "
                    f"{self._fpr_window_sec}s. Human review required."
                ),
                "acknowledged": False,
            }
            self._alert_history.append(alert)
            logger.warning(alert["message"])
            return alert

        if not threshold_crossed and self._alert_active:
            self._alert_active = False
            logger.info(
                f"Windowed FPR recovered to {windowed_fpr:.2%} "
                f"(below threshold {self.retraining_threshold_fpr:.2%}). "
                "Alert cleared automatically."
            )
        return None

    def acknowledge_alert(self) -> bool:
        """Human operator acknowledges the active alert."""
        if not self._alert_active:
            return False
        self._alert_active = False
        self._alert_triggered_at = None
        self._alert_fpr_value = None
        logger.info("Retraining alert acknowledged by operator.")
        return True
    
    def get_recent_events(self, limit: int = 50, min_score: float = 0.0, label_filter: Optional[int] = None) -> List[ClassificationResult]:
        """Get recent classification events with optional filtering."""
        events = list(self.recent_events)
        if label_filter is not None:
            events = [e for e in events if e.label == label_filter]
        if min_score > 0:
            events = [e for e in events if e.score >= min_score]
        return events[-limit:]
    
    def get_stats(self) -> dict:
        """Get streaming statistics."""
        denom = max(self.total_heartbeats, 1)
        raw_rate = self.total_anomalies / denom
        anomaly_rate = float(max(0.0, min(1.0, raw_rate)))
        
        recent_scores = [e.score for e in self.recent_events]
        avg_score = np.mean(recent_scores) if recent_scores else 0.0
        
        fpr = 0.0
        tpr = 0.0
        precision = 0.0
        f1_score = 0.0
        
        if self.has_ground_truth:
            denominator_fpr = self.false_positives + self.true_negatives
            if denominator_fpr > 0:
                fpr = self.false_positives / denominator_fpr
            denominator_tpr = self.true_positives + self.false_negatives
            if denominator_tpr > 0:
                tpr = self.true_positives / denominator_tpr
            denominator_precision = self.true_positives + self.false_positives
            if denominator_precision > 0:
                precision = self.true_positives / denominator_precision
            if precision + tpr > 0:
                f1_score = 2 * (precision * tpr) / (precision + tpr)

        windowed = self.get_windowed_stats()
        
        should_retrain = False
        if self.retraining_threshold_fpr is not None and windowed["fpr"] > self.retraining_threshold_fpr:
            should_retrain = True
        
        return {
            "total_flows_processed": self.total_flows,
            "total_anomalies_detected": self.total_anomalies,
            "anomaly_rate": anomaly_rate,
            "avg_anomaly_score": avg_score,
            "total_heartbeats": self.total_heartbeats,
            "node_count": self.preprocessor.get_node_count(),
            "buffer_size": self.buffer.get_size(),
            "true_positives": self.true_positives,
            "false_positives": self.false_positives,
            "true_negatives": self.true_negatives,
            "false_negatives": self.false_negatives,
            "fpr": fpr,
            "tpr": tpr,
            "precision": precision,
            "f1_score": f1_score,
            "retraining_threshold_fpr": self.retraining_threshold_fpr,
            "should_retrain": should_retrain,
            "windowed_fpr": windowed["fpr"],
            "windowed_tpr": windowed["tpr"],
            "windowed_precision": windowed["precision"],
            "windowed_f1": windowed["f1"],
            "windowed_window_sec": windowed["window_sec"],
            "windowed_event_count": windowed["window_event_count"],
            "alert_active": self._alert_active,
            "alert_triggered_at": self._alert_triggered_at,
            "alert_fpr_value": self._alert_fpr_value,
            "alert_threshold": self._alert_threshold,
        }
    
    def set_retraining_threshold(self, threshold_fpr: Optional[float]) -> None:
        """Set the FPR threshold for triggering retraining."""
        if threshold_fpr is not None and not (0.0 <= threshold_fpr <= 1.0):
            raise ValueError(f"FPR threshold must be between 0.0 and 1.0, got {threshold_fpr}")
        self.retraining_threshold_fpr = threshold_fpr
        logger.info(f"Retraining threshold FPR set to {threshold_fpr}")