"""Pydantic models for dashboard API."""

from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class NetFlowRecord(BaseModel):
    """A single NetFlow record from the network."""
    timestamp: float = Field(..., description="Unix timestamp")
    src_ip: str = Field(..., description="Source IP address")
    dst_ip: str = Field(..., description="Destination IP address")
    src_port: int = Field(..., description="Source port")
    dst_port: int = Field(..., description="Destination port")
    protocol: int = Field(..., description="Protocol number (6=TCP, 17=UDP)")
    bytes: int = Field(..., description="Total bytes transferred")
    packets: int = Field(..., description="Total packets")
    duration_ms: float = Field(default=0, description="Flow duration in ms")
    
    # Optional features (will be filled with defaults if missing)
    bytes_in: Optional[int] = None
    bytes_out: Optional[int] = None
    packets_in: Optional[int] = None
    packets_out: Optional[int] = None
    tcp_flags: Optional[int] = None
    
    class Config:
        schema_extra = {
            "example": {
                "timestamp": 1679000000.0,
                "src_ip": "192.168.1.10",
                "dst_ip": "8.8.8.8",
                "src_port": 54321,
                "dst_port": 443,
                "protocol": 6,
                "bytes": 5000,
                "packets": 10,
                "duration_ms": 1234.5
            }
        }


class ClassificationResult(BaseModel):
    """Classification result for a flow."""
    flow_id: str = Field(..., description="Unique flow identifier")
    timestamp: float
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
    score: float = Field(..., ge=0.0, le=1.0, description="Anomaly score [0, 1]")
    label: int = Field(..., ge=0, le=1, description="0=benign, 1=anomalous")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence")
    window_id: int = Field(..., description="Window ID this flow belongs to")
    processing_time_ms: float


class FlowBatchRequest(BaseModel):
    """Request to classify a batch of flows."""
    flows: List[NetFlowRecord]
    
    class Config:
        schema_extra = {
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
                        "packets": 10
                    }
                ]
            }
        }


class FlowBatchResponse(BaseModel):
    """Response with classification results."""
    classifications: List[ClassificationResult]
    batch_id: str
    processed_count: int
    error_count: int
    total_time_ms: float
    model_version: str


class EventsRequest(BaseModel):
    """Request recent classification events."""
    limit: int = Field(default=50, ge=1, le=1000)
    min_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Filter by minimum score")
    label_filter: Optional[int] = Field(default=None, ge=0, le=1, description="Filter by label (0 or 1)")


class DashboardStats(BaseModel):
    """Dashboard statistics."""
    total_flows_processed: int
    total_anomalies_detected: int
    anomaly_rate: float = Field(..., ge=0.0, le=1.0)
    avg_anomaly_score: float
    current_window_id: int
    model_version: str
    uptime_seconds: float
    node_count: int
    buffer_size: int


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="'healthy' or 'degraded'")
    model_loaded: bool
    scaler_loaded: bool
    message: str = Field(default="")


class ErrorResponse(BaseModel):
    """Error response."""
    detail: str
    error_code: str = Field(default="INTERNAL_ERROR")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
