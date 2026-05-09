"""Pydantic models for the GraphIDS dashboard API.

Changelog (rewrite):
- FIX: DashboardStats.current_window_id renamed to total_heartbeats to match
  the field name emitted by StreamProcessor.get_stats() after the stream.py
  rewrite. The /stats endpoint in serve.py maps stats["total_heartbeats"] to
  this field, preserving the frontend API contract.
- KEPT: All other fields, validators, and docstrings unchanged.
"""

from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class NetFlowRecord(BaseModel):
    """A single NetFlow record from the network."""

    timestamp: float = Field(..., description="Unix timestamp")
    src_ip: str      = Field(..., description="Source IP address")
    dst_ip: str      = Field(..., description="Destination IP address")
    src_port: int    = Field(..., description="Source port")
    dst_port: int    = Field(..., description="Destination port")
    protocol: int    = Field(..., description="Protocol number (6=TCP, 17=UDP)")
    bytes: int       = Field(..., description="Total bytes transferred")
    packets: int     = Field(..., description="Total packets")
    duration_ms: float = Field(default=0.0, description="Flow duration in ms")

    # Optional directional features (filled with halved totals if missing)
    bytes_in: Optional[int]    = None
    bytes_out: Optional[int]   = None
    packets_in: Optional[int]  = None
    packets_out: Optional[int] = None
    tcp_flags: Optional[int]   = None

    # Ground truth label for evaluation (NF-UNSW-NB15-v3 and similar)
    ground_truth_label: Optional[int] = Field(
        default=None,
        description="Ground truth label: 0=benign, 1=malicious (optional)",
    )

    # Full 51-feature training vector — used by RealTimePreprocessor when
    # available to exactly replicate training-time feature alignment.
    all_features: Optional[dict] = Field(
        default=None,
        description=(
            "Optional: all NF-UNSW-NB15-v3 features for accurate preprocessing. "
            "Keys must match scaler.feature_names_in_."
        ),
    )

    class Config:
        json_schema_extra = {
            "example": {
                "timestamp": 1679000000.0,
                "src_ip": "192.168.1.10",
                "dst_ip": "8.8.8.8",
                "src_port": 54321,
                "dst_port": 443,
                "protocol": 6,
                "bytes": 5000,
                "packets": 10,
                "duration_ms": 1234.5,
            }
        }


class FlowBatchRequest(BaseModel):
    """Request to classify a batch of flows."""

    flows: List[NetFlowRecord]

    class Config:
        json_schema_extra = {
            "example": {
                "flows": [
                    {
                        "timestamp": 1679000000.0,
                        "src_ip": "192.168.1.10",
                        "dst_ip": "8.8.8.8",
                        "src_port": 54321,
                        "dst_port": 443,
                        "protocol": 6,
                        "bytes": 5000,
                        "packets": 10,
                    }
                ]
            }
        }


class EventsRequest(BaseModel):
    """Parameters for querying recent classification events."""

    limit: int = Field(default=50, ge=1, le=1000)
    min_score: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Filter by minimum anomaly score",
    )
    label_filter: Optional[int] = Field(
        default=None, ge=0, le=1,
        description="Filter by label (0=benign, 1=anomalous)",
    )


# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------

class ClassificationResult(BaseModel):
    """Classification result for a single heartbeat window."""

    flow_id: str    = Field(..., description="Unique flow / heartbeat identifier")
    timestamp: float
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int

    score: float      = Field(..., ge=0.0, le=1.0, description="Anomaly score [0, 1]")
    label: int        = Field(..., ge=0, le=1,     description="0=benign, 1=anomalous")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence")
    severity: str     = Field(
        default="low",
        description="Human-readable tier: 'critical', 'high', 'medium', or 'low'.",
    )

    window_id: int          = Field(..., description="Heartbeat window counter")
    processing_time_ms: float

    ground_truth_label: Optional[int] = Field(
        default=None,
        description=(
            "ANY-ANOMALY ground truth over the full heartbeat window. "
            "1 if any flow in the window was malicious, 0 if all were benign, "
            "None if no ground truth labels were present."
        ),
    )

    # Flow characteristics for the dashboard flow inspector
    protocol: int    = Field(default=6,   description="Protocol number")
    bytes: int       = Field(default=0,   description="Total bytes transferred")
    packets: int     = Field(default=0,   description="Total packets")
    duration_ms: float = Field(default=0.0, description="Flow duration in milliseconds")


class FlowBatchResponse(BaseModel):
    """Response with classification results for a submitted batch."""

    classifications: List[ClassificationResult]
    batch_id: str
    processed_count: int
    error_count: int
    total_time_ms: float
    model_version: str


class DashboardStats(BaseModel):
    """Aggregated statistics for the dashboard /stats endpoint."""

    # ── Flow counters ──────────────────────────────────────────────────────
    total_flows_processed: int
    total_anomalies_detected: int
    anomaly_rate: float = Field(..., ge=0.0, le=1.0)
    avg_anomaly_score: float

    # Heartbeat window counter — previously called current_window_id.
    # Represents the number of 1-second heartbeat windows emitted since
    # startup (or last reset).  Renamed from current_window_id to match
    # StreamProcessor.get_stats()["total_heartbeats"].
    # The /stats endpoint maps this to current_window_id in the response
    # to preserve frontend compatibility.
    current_window_id: int = Field(
        ...,
        description=(
            "Total heartbeat windows emitted since startup. "
            "Populated from total_heartbeats in StreamProcessor."
        ),
    )

    model_version: str
    uptime_seconds: float
    node_count: int
    buffer_size: int

    # ── Lifetime confusion matrix ──────────────────────────────────────────
    true_positives:  int = Field(default=0)
    false_positives: int = Field(default=0)
    true_negatives:  int = Field(default=0)
    false_negatives: int = Field(default=0)

    # ── Lifetime derived metrics ───────────────────────────────────────────
    fpr: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Lifetime FPR = FP / (FP + TN)",
    )
    tpr: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Lifetime TPR = TP / (TP + FN)",
    )
    precision: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Lifetime Precision = TP / (TP + FP)",
    )
    f1_score: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Lifetime F1 Score",
    )

    retraining_threshold_fpr: Optional[float] = Field(
        default=None,
        description="FPR threshold above which retraining is recommended",
    )
    should_retrain: bool = Field(
        default=False,
        description="True when windowed FPR exceeds retraining_threshold_fpr",
    )

    # ── Windowed metrics (rolling 5-minute window) ─────────────────────────
    windowed_fpr:         float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_tpr:         float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_precision:   float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_f1:          float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_window_sec:  int   = Field(default=300)
    windowed_event_count: int   = Field(default=0)

    # ── Alert state ────────────────────────────────────────────────────────
    alert_active:        bool           = Field(default=False)
    alert_triggered_at:  Optional[float] = Field(default=None)
    alert_fpr_value:     Optional[float] = Field(default=None)
    alert_threshold:     Optional[float] = Field(default=None)


# ---------------------------------------------------------------------------
# System models
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Health check response."""

    status: str       = Field(..., description="'healthy' or 'degraded'")
    model_loaded: bool
    scaler_loaded: bool
    message: str      = Field(default="")


class ErrorResponse(BaseModel):
    """Standard error response body."""

    detail: str
    error_code: str   = Field(default="INTERNAL_ERROR")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HeartbeatEvent(BaseModel):
    """Discrete time-window aggregated event for heartbeat visualization."""

    timestamp: float  = Field(..., description="Unix timestamp of window end")
    score: float      = Field(..., ge=0.0, le=1.0, description="Aggregated anomaly score")
    label: int        = Field(..., ge=0, le=1,     description="0=benign, 1=anomalous")
    window_id: int    = Field(..., description="Heartbeat window counter")
    anomaly_count: int  = Field(default=0, description="Number of anomalies in window")
    flow_count: int     = Field(default=0, description="Total flows in window")
    top_anomaly_sources: List[str] = Field(
        default_factory=list,
        description="Top 5 source IPs with anomalies in this window",
    )