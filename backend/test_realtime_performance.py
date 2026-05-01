#!/usr/bin/env python3
"""
Real-time Performance Testing for GraphIDS Streaming Pipeline

Measures:
- Max Throughput (flows/sec)
- Accuracy during streaming
- F1 Score
- False Positive Rate (FPR)
- Latency (p50, p95, p99)
- Resource utilization (CPU, Memory)

FIX CHANGELOG vs original:
  FIX-1: Classification metrics now fetched from /stats endpoint after each test
          instead of trying to align per-flow predictions with window-level API output.
          The backend has the authoritative confusion matrix; the tester was reconstructing
          it incorrectly because the API returns one result per window, not per flow.
  FIX-2: CPU measurement now uses system-wide psutil.cpu_percent(), not the tester
          process, which always read 0.0% because the tester is nearly idle.
  FIX-3: Latency now recorded as per-request RTT. Dividing by batch size produced
          artificial numbers that did not represent anything measurable.
  FIX-4: Throughput now computed as a rolling 5-second time-window average to prevent
          instantaneous batch spikes (39→434 flows/sec) from distorting max/min values.
  FIX-5: Backend stats reset via /reset before each test level so runs are independent.
"""

import os
import sys
import time
import psutil
import numpy as np
import pandas as pd
import requests
import threading
from pathlib import Path
from collections import deque, defaultdict
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum
import json
from datetime import datetime
import logging

# ============================================================================
# LOGGING SETUP
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# DATA STRUCTURES
# ============================================================================

class ThroughputLevel(Enum):
    """Predefined throughput test levels"""
    LOW = 10          # 10 flows/sec
    MEDIUM = 50       # 50 flows/sec
    HIGH = 100        # 100 flows/sec
    VERY_HIGH = 500   # 500 flows/sec
    MAXIMUM = 2000    # 2000 flows/sec (stress test)


@dataclass
class PerformanceMetrics:
    """Stores performance metrics during a test run"""
    # Throughput metrics
    total_flows_processed: int = 0
    total_time_sec: float = 0.0
    avg_throughput: float = 0.0
    max_throughput: float = 0.0
    min_throughput: float = 0.0

    # Accuracy metrics
    total_predictions: int = 0
    correct_predictions: int = 0
    accuracy: float = 0.0

    # Classification metrics — populated from /stats after test (FIX-1)
    true_positives: int = 0
    false_positives: int = 0
    true_negatives: int = 0
    false_negatives: int = 0

    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    fpr: float = 0.0

    # Ground truth coverage: fraction of flows for which backend had a label
    ground_truth_coverage: float = 0.0

    # Latency metrics (milliseconds) — per REQUEST, not per flow (FIX-3)
    request_latencies: deque = field(default_factory=lambda: deque(maxlen=10000))
    avg_latency_ms: float = 0.0
    p50_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    p99_latency_ms: float = 0.0
    max_latency_ms: float = 0.0

    # Resource metrics
    cpu_usage_samples: deque = field(default_factory=lambda: deque(maxlen=1000))
    cpu_usage_percent: float = 0.0
    memory_usage_percent: float = 0.0
    memory_used_mb: float = 0.0
    max_memory_mb: float = 0.0

    # Throughput over time — rolling 5s window (FIX-4)
    throughput_timeline: List[Tuple[float, float]] = field(default_factory=list)

    # Test configuration
    test_name: str = "default"
    target_flows_per_sec: int = 0
    dataset_size: int = 0
    timestamp: str = ""

    # Cardinality tracking — how many predictions vs flows sent
    total_flows_sent: int = 0
    total_predictions_received: int = 0

    def calculate_derived_metrics(self):
        """Calculate derived metrics from raw counts"""
        # Accuracy from confusion matrix values (sourced from backend /stats)
        total = self.true_positives + self.false_positives + self.true_negatives + self.false_negatives
        if total > 0:
            self.accuracy = (self.true_positives + self.true_negatives) / total
            self.total_predictions = total
            self.correct_predictions = self.true_positives + self.true_negatives

        # Precision: TP / (TP + FP)
        if self.true_positives + self.false_positives > 0:
            self.precision = self.true_positives / (self.true_positives + self.false_positives)

        # Recall: TP / (TP + FN)
        if self.true_positives + self.false_negatives > 0:
            self.recall = self.true_positives / (self.true_positives + self.false_negatives)

        # F1 Score
        if self.precision + self.recall > 0:
            self.f1_score = 2 * (self.precision * self.recall) / (self.precision + self.recall)

        # FPR: FP / (FP + TN)
        if self.false_positives + self.true_negatives > 0:
            self.fpr = self.false_positives / (self.false_positives + self.true_negatives)

        # Latency percentiles from per-request RTTs (FIX-3)
        if self.request_latencies:
            latencies_sorted = sorted(self.request_latencies)
            self.avg_latency_ms = float(np.mean(latencies_sorted))
            self.p50_latency_ms = float(np.percentile(latencies_sorted, 50))
            self.p95_latency_ms = float(np.percentile(latencies_sorted, 95))
            self.p99_latency_ms = float(np.percentile(latencies_sorted, 99))
            self.max_latency_ms = float(np.max(latencies_sorted))

        # CPU: average of all samples taken during the run (FIX-2)
        if self.cpu_usage_samples:
            self.cpu_usage_percent = float(np.mean(self.cpu_usage_samples))

        # Throughput
        if self.total_time_sec > 0:
            self.avg_throughput = self.total_flows_processed / self.total_time_sec

        # Ground truth coverage
        if self.total_flows_sent > 0:
            total_gt = self.true_positives + self.false_positives + self.true_negatives + self.false_negatives
            self.ground_truth_coverage = total_gt / self.total_flows_sent

    def to_dict(self) -> Dict:
        """Convert metrics to dictionary for JSON serialization"""
        return {
            "timestamp": self.timestamp,
            "test_name": self.test_name,
            "configuration": {
                "target_flows_per_sec": self.target_flows_per_sec,
                "dataset_size": self.dataset_size,
            },
            "throughput": {
                "total_flows": self.total_flows_processed,
                "total_time_sec": round(self.total_time_sec, 3),
                "avg_flows_per_sec": round(self.avg_throughput, 2),
                "max_flows_per_sec": round(self.max_throughput, 2),
                "min_flows_per_sec": round(self.min_throughput, 2),
            },
            "cardinality": {
                "flows_sent": self.total_flows_sent,
                "predictions_received": self.total_predictions_received,
                # ratio < 1.0 means backend is returning window-level results, not per-flow
                "prediction_ratio": round(
                    self.total_predictions_received / max(self.total_flows_sent, 1), 4
                ),
            },
            "accuracy": {
                # Derived from backend confusion matrix, not client-side alignment
                "accuracy": round(self.accuracy, 4),
                "correct_predictions": self.correct_predictions,
                "total_predictions": self.total_predictions,
                "ground_truth_coverage": round(self.ground_truth_coverage, 4),
                "note": (
                    "Metrics sourced from backend /stats endpoint. "
                    "ground_truth_coverage < 1.0 means some flows had no ground truth label."
                ),
            },
            "classification": {
                "precision": round(self.precision, 4),
                "recall": round(self.recall, 4),
                "f1_score": round(self.f1_score, 4),
                "fpr": round(self.fpr, 4),
                "confusion_matrix": {
                    "true_positives": self.true_positives,
                    "false_positives": self.false_positives,
                    "true_negatives": self.true_negatives,
                    "false_negatives": self.false_negatives,
                },
            },
            "latency_ms": {
                # Per-request RTT — not divided by batch size (FIX-3)
                "note": "Per-request round-trip time. Divide by batch_size for per-flow estimate.",
                "avg": round(self.avg_latency_ms, 2),
                "p50": round(self.p50_latency_ms, 2),
                "p95": round(self.p95_latency_ms, 2),
                "p99": round(self.p99_latency_ms, 2),
                "max": round(self.max_latency_ms, 2),
            },
            "resources": {
                # System-wide CPU average over test duration (FIX-2)
                "cpu_usage_percent": round(self.cpu_usage_percent, 2),
                "memory_usage_percent": round(self.memory_usage_percent, 2),
                "memory_used_mb": round(self.memory_used_mb, 2),
                "max_memory_mb": round(self.max_memory_mb, 2),
            },
        }


# ============================================================================
# STREAMING TEST ENGINE
# ============================================================================

class RealtimePerformanceTester:
    """Main testing engine for real-time streaming performance"""

    def __init__(
        self,
        api_url: str = "http://127.0.0.1:8000/classify",
        stats_url: str = "http://127.0.0.1:8000/stats",
        reset_url: str = "http://127.0.0.1:8000/reset",
        dataset_path: Optional[str] = None,
        checkpoint_label_column: str = "Label",
        debug: bool = False,
    ):
        self.api_url = api_url
        self.stats_url = stats_url       # FIX-1: need /stats to pull authoritative metrics
        self.reset_url = reset_url       # FIX-5: need /reset to isolate test runs
        self.checkpoint_label_column = checkpoint_label_column
        self.debug = debug
        self.session = requests.Session()

        if dataset_path is None:
            dataset_path = Path(__file__).parents[2] / "data" / "NF-UNSW-NB15-v3" / "NF-UNSW-NB15-v3.csv"

        self.dataset_path = Path(dataset_path)
        self.data: Optional[pd.DataFrame] = None
        self.metrics = PerformanceMetrics()

        self._load_dataset()

    def _load_dataset(self):
        """Load the dataset for streaming"""
        if not self.dataset_path.exists():
            raise FileNotFoundError(f"Dataset not found at {self.dataset_path}")

        logger.info(f"Loading dataset from {self.dataset_path}")
        self.data = pd.read_csv(self.dataset_path)
        logger.info(f"Dataset loaded: {len(self.data)} flows")

    def _reset_backend_stats(self):
        """
        FIX-5: Reset backend confusion matrix before each test level.
        Without this, MEDIUM accumulates stats from LOW, HIGH accumulates from both.
        """
        try:
            resp = self.session.post(self.reset_url, timeout=5)
            if resp.status_code == 200:
                logger.info("Backend stats reset successfully.")
            else:
                logger.warning(f"Backend reset returned status {resp.status_code}. "
                               "Stats from previous run may contaminate this test.")
        except requests.RequestException as e:
            logger.warning(f"Could not reset backend stats: {e}. "
                           "Stats from previous run may contaminate this test.")

    def _fetch_backend_stats(self) -> Optional[Dict]:
        """
        FIX-1: Fetch authoritative classification metrics from /stats.
        The backend tracks the confusion matrix using the ground_truth_label
        field embedded in each flow. This is the only correct source for
        TP/FP/TN/FN — the client cannot reconstruct these because the API
        returns window-level results, not per-flow results.
        """
        try:
            resp = self.session.get(self.stats_url, timeout=5)
            if resp.status_code == 200:
                return resp.json()
            else:
                logger.warning(f"/stats returned status {resp.status_code}")
                return None
        except requests.RequestException as e:
            logger.warning(f"Could not fetch /stats: {e}")
            return None

    def _row_to_flow(self, row: pd.Series) -> Tuple[Dict, Optional[int]]:
        """Convert dataset row to flow format"""
        def safe_float(val, default=1e-6):
            try:
                f = float(val)
                if np.isnan(f) or np.isinf(f):
                    return default
                return f
            except Exception:
                return default

        in_bytes = safe_float(row.get("IN_BYTES"))
        out_bytes = safe_float(row.get("OUT_BYTES"))
        in_pkts = safe_float(row.get("IN_PKTS"))
        out_pkts = safe_float(row.get("OUT_PKTS"))

        ground_truth = None
        if self.checkpoint_label_column in row:
            try:
                ground_truth = int(row[self.checkpoint_label_column])
            except (ValueError, TypeError):
                pass

        flow = {
            "timestamp": time.time(),
            "src_ip": str(row.get("IPV4_SRC_ADDR", "0.0.0.0")),
            "dst_ip": str(row.get("IPV4_DST_ADDR", "0.0.0.0")),
            "src_port": int(row.get("L4_SRC_PORT", 0)),
            "dst_port": int(row.get("L4_DST_PORT", 0)),
            "protocol": int(row.get("PROTOCOL", 0)),
            "bytes": int(in_bytes + out_bytes),
            "packets": int(in_pkts + out_pkts),
            "duration_ms": safe_float(row.get("FLOW_DURATION_MILLISECONDS")),
        }

        if ground_truth is not None:
            flow["ground_truth_label"] = ground_truth

        return flow, ground_truth

    def _send_batch(self, flows: List[Dict]) -> Tuple[List[Dict], float]:
        """
        Send one batch to /classify. Returns (predictions, latency_ms).
        Latency is the full round-trip for this request — not divided by
        batch size (FIX-3). The caller decides how to interpret it.
        """
        try:
            start_time = time.perf_counter()
            response = self.session.post(
                self.api_url,
                json={"flows": flows},
                timeout=30,
            )
            latency_ms = (time.perf_counter() - start_time) * 1000.0

            if response.status_code != 200:
                logger.warning(f"API returned status {response.status_code}: {response.text[:200]}")
                return [], latency_ms

            response_data = response.json()

            predictions = []
            if isinstance(response_data, dict):
                if "classifications" in response_data:
                    predictions = response_data["classifications"]
                elif "results" in response_data:
                    predictions = response_data["results"]
                else:
                    logger.warning(f"Unexpected response keys: {list(response_data.keys())}")
            elif isinstance(response_data, list):
                predictions = response_data

            # Log cardinality mismatch without treating it as an error —
            # it is expected because the backend outputs per-window, not per-flow.
            if len(predictions) != len(flows):
                logger.debug(
                    f"Cardinality: sent {len(flows)} flows, received {len(predictions)} predictions "
                    f"(window-level output is expected — metrics come from /stats not from this count)."
                )

            return predictions, latency_ms

        except requests.RequestException as e:
            logger.error(f"Request failed: {e}")
            return [], 0.0

    def _collect_system_metrics(self):
        """
        FIX-2: Measure system-wide CPU usage, not the tester process.
        The tester process is nearly idle (it spends most time in sleep/network wait),
        so measuring self.process.cpu_percent() always returned ~0.0%.
        System-wide CPU captures the backend process and any GPU driver overhead.
        """
        # System-wide CPU — captures backend, not just this script
        cpu = psutil.cpu_percent(interval=None)
        self.metrics.cpu_usage_samples.append(cpu)

        # Memory: still track the tester process for its own footprint
        proc = psutil.Process()
        mem = proc.memory_info()
        self.metrics.memory_used_mb = mem.rss / 1024 / 1024
        self.metrics.memory_usage_percent = proc.memory_percent()
        if self.metrics.memory_used_mb > self.metrics.max_memory_mb:
            self.metrics.max_memory_mb = self.metrics.memory_used_mb

    def run_throughput_test(
        self,
        throughput_level: ThroughputLevel,
        test_duration_sec: int = 60,
        batch_size: int = 10,
    ) -> PerformanceMetrics:
        """
        Test performance at a specific throughput level.

        Classification metrics (FPR, F1, precision, recall, confusion matrix)
        are sourced from the backend /stats endpoint after the test completes.
        Throughput and latency are measured client-side.
        """
        if self.data is None:
            raise RuntimeError("Dataset not loaded")

        flows_per_sec = throughput_level.value

        self.metrics = PerformanceMetrics(
            test_name=f"throughput_test_{throughput_level.name}",
            target_flows_per_sec=flows_per_sec,
            dataset_size=len(self.data),
            timestamp=datetime.now().isoformat(),
        )

        # FIX-5: Reset backend stats so this test is independent of previous runs
        self._reset_backend_stats()

        # Prime psutil CPU sampler — first call always returns 0.0
        psutil.cpu_percent(interval=None)

        logger.info(
            f"Starting throughput test: {flows_per_sec} flows/sec "
            f"for {test_duration_sec}s, batch_size={batch_size}"
        )

        start_time = time.perf_counter()

        # FIX-4: Throughput via rolling 5-second time window
        # Stores (timestamp, flows_in_this_second) tuples
        window_events: deque = deque()  # (event_time, flow_count)
        THROUGHPUT_WINDOW_SEC = 5.0
        throughput_samples: deque = deque(maxlen=500)

        batch_accumulator: List[Dict] = []
        row_index = 0
        total_rows = len(self.data)

        # Resource sampling thread
        stop_sampling = threading.Event()

        def sample_resources():
            while not stop_sampling.is_set():
                self._collect_system_metrics()
                time.sleep(1.0)

        sampler = threading.Thread(target=sample_resources, daemon=True)
        sampler.start()

        try:
            while time.perf_counter() - start_time < test_duration_sec:
                elapsed = time.perf_counter() - start_time
                expected_total = int(flows_per_sec * elapsed)
                deficit = expected_total - self.metrics.total_flows_processed

                # Fill the deficit with flows from the dataset
                flows_to_add = min(deficit, batch_size, total_rows - row_index)
                if flows_to_add <= 0:
                    time.sleep(0.005)
                    continue

                for _ in range(flows_to_add):
                    if row_index >= total_rows:
                        break
                    flow, _ = self._row_to_flow(self.data.iloc[row_index])
                    batch_accumulator.append(flow)
                    row_index += 1

                # Send when batch is full or we have been accumulating too long
                if len(batch_accumulator) >= batch_size:
                    batch = batch_accumulator[:batch_size]
                    batch_accumulator = batch_accumulator[batch_size:]

                    predictions, latency_ms = self._send_batch(batch)

                    # FIX-3: Record per-request latency, not divided by flows
                    self.metrics.request_latencies.append(latency_ms)

                    # Cardinality tracking
                    self.metrics.total_flows_sent += len(batch)
                    self.metrics.total_predictions_received += len(predictions)

                    # FIX-4: Rolling throughput window
                    now = time.perf_counter()
                    window_events.append((now, len(batch)))
                    # Evict events older than THROUGHPUT_WINDOW_SEC
                    while window_events and (now - window_events[0][0]) > THROUGHPUT_WINDOW_SEC:
                        window_events.popleft()
                    window_flows = sum(e[1] for e in window_events)
                    window_duration = max(
                        now - window_events[0][0], 0.001
                    ) if window_events else 0.001
                    current_throughput = window_flows / window_duration
                    throughput_samples.append(current_throughput)
                    self.metrics.throughput_timeline.append(
                        (elapsed, round(current_throughput, 2))
                    )

                    self.metrics.total_flows_processed += len(batch)

                else:
                    time.sleep(0.001)

        finally:
            stop_sampling.set()
            sampler.join(timeout=2.0)

        # Send any remaining flows
        if batch_accumulator:
            predictions, latency_ms = self._send_batch(batch_accumulator)
            self.metrics.request_latencies.append(latency_ms)
            self.metrics.total_flows_sent += len(batch_accumulator)
            self.metrics.total_predictions_received += len(predictions)
            self.metrics.total_flows_processed += len(batch_accumulator)

        self.metrics.total_time_sec = time.perf_counter() - start_time

        # FIX-4: Throughput min/max from rolling window samples (no spikes)
        if throughput_samples:
            self.metrics.max_throughput = float(max(throughput_samples))
            self.metrics.min_throughput = float(min(throughput_samples))

        # FIX-1: Pull authoritative classification metrics from backend /stats
        backend_stats = self._fetch_backend_stats()
        if backend_stats:
            self.metrics.true_positives = backend_stats.get("true_positives", 0)
            self.metrics.false_positives = backend_stats.get("false_positives", 0)
            self.metrics.true_negatives = backend_stats.get("true_negatives", 0)
            self.metrics.false_negatives = backend_stats.get("false_negatives", 0)

            gt_total = (
                self.metrics.true_positives
                + self.metrics.false_positives
                + self.metrics.true_negatives
                + self.metrics.false_negatives
            )
            if gt_total == 0:
                logger.warning(
                    "Backend /stats shows 0 flows with ground truth labels. "
                    "Verify that ground_truth_label is being sent in each flow "
                    "and that the backend is propagating it to its confusion matrix."
                )
        else:
            logger.warning(
                "Could not reach /stats. Classification metrics will be zero. "
                "Throughput and latency numbers are still valid."
            )

        self.metrics.calculate_derived_metrics()

        logger.info(
            f"Test complete: {self.metrics.total_flows_processed} flows in "
            f"{self.metrics.total_time_sec:.2f}s "
            f"({self.metrics.avg_throughput:.1f} flows/sec avg). "
            f"Predictions received: {self.metrics.total_predictions_received} "
            f"(ratio {self.metrics.total_predictions_received / max(self.metrics.total_flows_sent,1):.3f})"
        )

        return self.metrics

    def run_stress_test(
        self,
        max_throughput_level: ThroughputLevel = ThroughputLevel.MAXIMUM,
        test_duration_sec: int = 30,
        batch_size: int = 10,
    ) -> List[PerformanceMetrics]:
        """
        Run progressive stress test across throughput levels.
        Each level is isolated by /reset (FIX-5).
        """
        results = []

        for level in ThroughputLevel:
            if level.value <= max_throughput_level.value:
                logger.info(f"\n{'='*60}")
                logger.info(f"Testing: {level.name} ({level.value} flows/sec)")
                logger.info(f"{'='*60}")

                metrics = self.run_throughput_test(
                    throughput_level=level,
                    test_duration_sec=test_duration_sec,
                    batch_size=batch_size,
                )
                results.append(metrics)
                time.sleep(5)

        return results

    def save_results(self, metrics, output_path: Optional[str] = None):
        """Save test results to JSON file"""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = f"performance_results_{timestamp}.json"

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(metrics, list):
            data = [m.to_dict() for m in metrics]
        else:
            data = metrics.to_dict()

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        logger.info(f"Results saved to {output_path}")

    def print_results(self, metrics: PerformanceMetrics):
        """Print formatted test results"""
        print("\n" + "=" * 80)
        print(f"REAL-TIME PERFORMANCE TEST RESULTS - {metrics.test_name}")
        print("=" * 80)

        print("\nTHROUGHPUT METRICS")
        print(f"  Total Flows Sent:        {metrics.total_flows_sent:,}")
        print(f"  Predictions Received:    {metrics.total_predictions_received:,}")
        print(f"  Prediction Ratio:        "
              f"{metrics.total_predictions_received / max(metrics.total_flows_sent,1):.4f} "
              f"(1.0 = per-flow, <1.0 = window-level output)")
        print(f"  Test Duration:           {metrics.total_time_sec:.2f} seconds")
        print(f"  Avg Throughput:          {metrics.avg_throughput:.2f} flows/sec")
        print(f"  Max Throughput (5s win): {metrics.max_throughput:.2f} flows/sec")
        print(f"  Min Throughput (5s win): {metrics.min_throughput:.2f} flows/sec")

        print("\nACCURACY METRICS  [sourced from backend /stats — authoritative]")
        print(f"  Ground Truth Coverage:   {metrics.ground_truth_coverage*100:.1f}% of flows had labels")
        print(f"  Accuracy:                {metrics.accuracy*100:.2f}%")

        print("\nCLASSIFICATION METRICS")
        print(f"  Precision:               {metrics.precision:.4f}")
        print(f"  Recall:                  {metrics.recall:.4f}")
        print(f"  F1 Score:                {metrics.f1_score:.4f}")
        print(f"  False Positive Rate:     {metrics.fpr:.4f} ({metrics.fpr*100:.2f}%)")
        print(f"  Confusion Matrix:")
        print(f"    TP={metrics.true_positives}  FP={metrics.false_positives}")
        print(f"    FN={metrics.false_negatives}  TN={metrics.true_negatives}")

        print("\nLATENCY METRICS (per-request RTT, milliseconds)")
        print(f"  Avg:   {metrics.avg_latency_ms:.2f} ms")
        print(f"  p50:   {metrics.p50_latency_ms:.2f} ms")
        print(f"  p95:   {metrics.p95_latency_ms:.2f} ms")
        print(f"  p99:   {metrics.p99_latency_ms:.2f} ms")
        print(f"  Max:   {metrics.max_latency_ms:.2f} ms")

        print("\nRESOURCE METRICS")
        print(f"  System CPU Avg:          {metrics.cpu_usage_percent:.2f}%")
        print(f"  Tester Memory Used:      {metrics.memory_used_mb:.2f} MB")
        print(f"  Tester Memory Peak:      {metrics.max_memory_mb:.2f} MB")
        print(f"  Tester Memory %:         {metrics.memory_usage_percent:.2f}%")

        print("\n" + "=" * 80 + "\n")


# ============================================================================
# MAIN EXECUTION
# ============================================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Real-time Performance Testing for GraphIDS"
    )
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/classify")
    parser.add_argument("--stats-url", default="http://127.0.0.1:8000/stats")
    parser.add_argument("--reset-url", default="http://127.0.0.1:8000/reset")
    parser.add_argument("--dataset", default=None)
    parser.add_argument(
        "--test-type",
        choices=["quick", "standard", "stress"],
        default="standard",
    )
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Flows per HTTP request")
    parser.add_argument("--output", default=None)
    parser.add_argument("--debug", action="store_true")

    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    tester = RealtimePerformanceTester(
        api_url=args.api_url,
        stats_url=args.stats_url,
        reset_url=args.reset_url,
        dataset_path=args.dataset,
        debug=args.debug,
    )

    if args.test_type == "quick":
        metrics = tester.run_throughput_test(
            throughput_level=ThroughputLevel.LOW,
            test_duration_sec=30,
            batch_size=args.batch_size,
        )
        tester.print_results(metrics)
        tester.save_results(metrics, args.output)

    elif args.test_type == "standard":
        levels = [ThroughputLevel.LOW, ThroughputLevel.MEDIUM, ThroughputLevel.HIGH]
        all_metrics = []
        for level in levels:
            metrics = tester.run_throughput_test(
                throughput_level=level,
                test_duration_sec=args.duration,
                batch_size=args.batch_size,
            )
            tester.print_results(metrics)
            all_metrics.append(metrics)
            time.sleep(5)

        tester.save_results(all_metrics, args.output)

    else:  # stress
        all_metrics = tester.run_stress_test(
            max_throughput_level=ThroughputLevel.VERY_HIGH,
            test_duration_sec=args.duration,
            batch_size=args.batch_size,
        )
        tester.save_results(all_metrics, args.output)


if __name__ == "__main__":
    main()