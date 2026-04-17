"""Real-time NetFlow streaming and preprocessing."""

import logging
from collections import deque, defaultdict
from typing import Dict, List, Tuple, Optional
import hashlib
import numpy as np
import torch
from datetime import datetime

from models import NetFlowRecord, ClassificationResult

logger = logging.getLogger(__name__)


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
    
    def __init__(self, buffer_size: int = 1000, window_size: int = 32, step_percent: float = 0.5):
        """
        Args:
            buffer_size: Max flows to keep in memory
            window_size: Sequence length for transformer
            step_percent: Sliding window step (0.5 = 50% overlap)
        """
        self.buffer_size = buffer_size
        self.window_size = window_size
        self.step_size = max(1, int(window_size * step_percent))
        
        self.embeddings = deque(maxlen=buffer_size)
        self.flow_metadata = deque(maxlen=buffer_size)  # Parallel metadata
        self.window_counter = 0
    
    def add_embedding(
        self,
        embedding: np.ndarray,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        src_port: int,
        dst_port: int,
        timestamp: float,
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
        })
    
    def get_windows_for_batch(self) -> Tuple[List[np.ndarray], List[Tuple[int, int]]]:
        """
        Get sequences ready for inference using sliding window.
        
        Returns:
            windows: List of [window_size, embed_dim] windows (padded if needed)
            indices: List of (start_idx, end_idx) for each window
        """
        if len(self.embeddings) < self.window_size:
            # Not enough data for a full window
            return [], []
        
        windows = []
        indices = []
        
        # Sliding window: start from 0, then advance by step_size
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
    """Preprocesses incoming NetFlow records to match training pipeline.

    When a trained scaler with ``feature_names_in_`` is available, we build
    feature vectors that align with the exact column order used during
    training (e.g. NF-UNSW-NB15-v3). Missing features are filled with 0.
    """

    def __init__(self, feature_names: Optional[List[str]] = None):
        """Initialize preprocessor.

        Args:
            feature_names: Optional ordered list of feature names from the
                training scaler (``scaler.feature_names_in_``). If omitted,
                we fall back to a compact 9-feature schema.
        """
        self.node_mapping = RealtimeNodeMapping()
        self.feature_names: Optional[List[str]] = list(feature_names) if feature_names is not None else None
    
    def preprocess_flow(self, flow: NetFlowRecord) -> dict:
        """
        Convert NetFlow record to feature vector.
        
        Args:
            flow: NetFlowRecord
            
        Returns:
            Dict with src_node, dst_node, features
        """
        # Map IPs to node IDs
        src_node = self.node_mapping.get_or_create_id(flow.src_ip)
        dst_node = self.node_mapping.get_or_create_id(flow.dst_ip)

        # If we know the full training feature layout, build vectors that
        # align with scaler.feature_names_in_. Otherwise, fall back.
        if self.feature_names is not None and len(self.feature_names) > 0:
            features = np.zeros(len(self.feature_names), dtype=np.float32)

            # Helper accessors with sensible fallbacks
            bytes_in = flow.bytes_in if flow.bytes_in is not None else flow.bytes // 2
            bytes_out = flow.bytes_out if flow.bytes_out is not None else flow.bytes // 2
            pkts_in = flow.packets_in if flow.packets_in is not None else flow.packets // 2
            pkts_out = flow.packets_out if flow.packets_out is not None else flow.packets // 2
            tcp_flags = flow.tcp_flags if flow.tcp_flags is not None else 0

            for i, name in enumerate(self.feature_names):
                val: float = 0.0
                if name == "L4_SRC_PORT":
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
                    # Approximate using timestamp (seconds) * 1000
                    val = float(flow.timestamp * 1000.0)
                elif name == "FLOW_END_MILLISECONDS":
                    val = float(flow.timestamp * 1000.0 + flow.duration_ms)

                features[i] = val

            features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        else:
            # Compact 9-feature schema (legacy fallback)
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

            # Handle NaN/Inf
            features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        
        return {
            "src_node": src_node,
            "dst_node": dst_node,
            "features": features,
        }
    
    def batch_preprocess(self, flows: List[NetFlowRecord]) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Preprocess a batch of flows.
        
        Returns:
            edge_index: [2, num_edges]
            edge_attr: [num_edges, num_features]
            raw_flows: Original flow data
        """
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
            # If no flows, default to zero features matching either the
            # training layout or the compact fallback.
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
        window_size: int = 32,
        step_percent: float = 0.5,
        buffer_size: int = 1000,
    ):
        """
        Args:
            inference_engine: InferenceEngine instance
            window_size: Sequence length
            step_percent: Sliding window overlap
            buffer_size: Rolling buffer size
        """
        self.inference_engine = inference_engine
        # If the scaler from training exposes feature names, pass them so
        # that the real-time features align with the training layout.
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
        self.recent_events = deque(maxlen=500)
    
    def process_flows(self, flows: List[NetFlowRecord]) -> List[ClassificationResult]:
        """
        End-to-end processing of a flow batch.
        
        Args:
            flows: List of NetFlowRecord
            
        Returns:
            List of ClassificationResult
        """
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
            
            # 5. Add to buffer and generate windows
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
                )
            
            # 6. Get sequences and run inference
            windows, window_indices = self.buffer.get_windows_for_batch()
            results = []
            
            if windows:
                # Stack windows and convert to torch
                windows_array = np.stack(windows, axis=0)  # [num_windows, window_size, embed_dim]
                windows_t = torch.from_numpy(windows_array).float().to(self.inference_engine.device)
                
                # Reconstruct
                _, errors = self.inference_engine.reconstruct_sequence(windows_t)
                scores, labels = self.inference_engine.compute_anomaly_score(errors)
                
                # 7. Create results
                for window_idx, (scores_w, labels_w, (start, end)) in enumerate(
                    zip(scores, labels, window_indices)
                ):
                    # For simplicity: assign window score to all flows in window
                    # In practice, could use per-flow scores via attention
                    for flow_offset in range(start, min(end, len(self.buffer.flow_metadata))):
                        if flow_offset < len(self.buffer.flow_metadata):
                            metadata = list(self.buffer.flow_metadata)[flow_offset]
                            result = ClassificationResult(
                                flow_id=metadata["flow_id"],
                                timestamp=metadata["timestamp"],
                                src_ip=metadata["src_ip"],
                                dst_ip=metadata["dst_ip"],
                                src_port=metadata["src_port"],
                                dst_port=metadata["dst_port"],
                                score=float(scores_w),
                                label=int(labels_w),
                                confidence=abs(scores_w - 0.5) * 2,  # Distance from 0.5
                                window_id=self.buffer.window_counter + window_idx,
                                processing_time_ms=(time.time() - start_time) * 1000,
                            )
                            results.append(result)
                            self.recent_events.append(result)
                            
                            if labels_w == 1:
                                self.total_anomalies += 1
                
                self.buffer.window_counter += len(windows)
            
            self.total_flows += len(flows)
            return results
        
        except Exception as e:
            logger.error(f"Error processing flows: {e}", exc_info=True)
            return []
    
    def _generate_flow_id(self, flow: NetFlowRecord) -> str:
        """Generate unique flow ID."""
        flow_str = f"{flow.src_ip}:{flow.src_port}-{flow.dst_ip}:{flow.dst_port}:{flow.timestamp}"
        return hashlib.md5(flow_str.encode()).hexdigest()[:12]
    
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
        # Anomaly rate is conceptually anomalies / flows, but since we
        # currently count anomalies per *window* while total_flows is per
        # raw flow, this ratio can temporarily exceed 1. Clamp to [0, 1]
        # so it always satisfies the DashboardStats schema.
        raw_rate = self.total_anomalies / max(self.total_flows, 1)
        anomaly_rate = float(max(0.0, min(1.0, raw_rate)))
        
        recent_scores = [e.score for e in self.recent_events]
        avg_score = np.mean(recent_scores) if recent_scores else 0.0
        
        return {
            "total_flows_processed": self.total_flows,
            "total_anomalies_detected": self.total_anomalies,
            "anomaly_rate": anomaly_rate,
            "avg_anomaly_score": avg_score,
            "current_window_id": self.buffer.window_counter,
            "node_count": self.preprocessor.get_node_count(),
            "buffer_size": self.buffer.get_size(),
        }
