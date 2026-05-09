

"""FastAPI server for GraphIDS real-time dashboard."""

import logging
import os
import sys
import yaml
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
import time
import subprocess

import torch
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic_settings import BaseSettings

from models import (
    FlowBatchRequest, FlowBatchResponse, ClassificationResult,
    EventsRequest, DashboardStats, HealthResponse, ErrorResponse,
)
from inference import InferenceEngine
from stream import StreamProcessor

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log_level_name = os.getenv("LOG_LEVEL", "WARNING").upper()
log_level = getattr(logging, log_level_name, logging.WARNING)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def _default_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


class Settings(BaseSettings):
    """Configuration settings — overridable via config_dashboard.yaml or env."""

    # Model
    model_checkpoint_path: str = "../../models/GraphIDS_NF-UNSW-NB15-v3_42.ckpt"
    model_scaler_path: str = "../../models/NF-UNSW-NB15-v3/scaler.pkl"
    model_device: str = _default_device()

    # Streaming — window_size MUST match the trained model (512)
    window_size: int = 512
    step_percent: float = 0.5
    buffer_size: int = 1000

    # API
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    api_workers: int = 1
    api_debug: bool = False

    # Advanced
    recent_events_size: int = 500
    max_nodes: int = 100_000

    class Config:
        env_file = ".env"


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

def load_config(config_path: Optional[str] = None) -> dict:
    """Load configuration from a YAML file, falling back to defaults."""
    if config_path is None:
        candidates = [
            Path("config_dashboard.yaml"),
            Path("../config_dashboard.yaml"),
            Path("../../config_dashboard.yaml"),
        ]
        for p in candidates:
            if p.exists():
                config_path = str(p)
                break

    if config_path and Path(config_path).exists():
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)
        logger.info("Loaded config from %s", config_path)
        return config

    logger.warning("No config file found; using defaults.")
    return {}


async def _prewarm_buffer(csv_path: Path, n_flows: int = 600) -> None:
    """
    Fill the flow buffer with benign embeddings before demo streaming begins.

    Reads the first N benign rows from the dataset CSV, encodes them
    through the full preprocessing + GNN encoder pipeline, and deposits
    their embeddings into the buffer. This ensures the 512-flow window
    fills immediately when the external streamer sends its first flow.

    Ground truth labels are intentionally omitted so pre-warm flows
    do not pollute the confusion matrix or normalizer baseline.

    Args:
        csv_path: Absolute path to the dataset CSV file.
        n_flows:  Number of benign flows to pre-warm with. Must be at
                  least window_size (512). 600 provides a small margin.
    """
    if not csv_path.exists():
        logger.warning(
            "Pre-warm skipped — dataset CSV not found at %s. "
            "Dashboard will have a blank period until %d flows are streamed.",
            csv_path,
            n_flows,
        )
        return

    logger.info("Pre-warming buffer with %d benign flows from %s...", n_flows, csv_path)

    try:
        import pandas as pd
        from models import NetFlowRecord
        import time as _t

        def _safe_float(val, default: float = 1e-6) -> float:
            """Convert value to float, replacing NaN/Inf with default."""
            try:
                f = float(val)
                if f != f or f == float("inf") or f == float("-inf"):
                    return default
                return f
            except Exception:
                return default

        # Read enough rows to guarantee n_flows benign after filtering.
        # NF-UNSW-NB15-v3 is ~86.5% benign, so reading 4x is safe.
        oversample_factor = 4
        df = pd.read_csv(csv_path, nrows=n_flows * oversample_factor)

        # Filter to benign only — do not contaminate normalizer baseline
        if "Label" in df.columns:
            df = df[df["Label"] == 0]
        df = df.head(n_flows)

        if len(df) == 0:
            logger.warning("Pre-warm: no benign rows found in first %d rows of CSV.", n_flows * oversample_factor)
            return

        # Build NetFlowRecord objects
        batch = []
        prewarm_time = _t.time()

        for _, row in df.iterrows():
            in_b  = _safe_float(row.get("IN_BYTES"))
            out_b = _safe_float(row.get("OUT_BYTES"))
            in_p  = _safe_float(row.get("IN_PKTS"))
            out_p = _safe_float(row.get("OUT_PKTS"))

            record = NetFlowRecord(
                timestamp  = prewarm_time,
                src_ip     = str(row.get("IPV4_SRC_ADDR", "0.0.0.0")),
                dst_ip     = str(row.get("IPV4_DST_ADDR", "0.0.0.0")),
                src_port   = int(row.get("L4_SRC_PORT",   0)),
                dst_port   = int(row.get("L4_DST_PORT",   0)),
                protocol   = int(row.get("PROTOCOL",      0)),
                bytes      = int(in_b + out_b),
                packets    = int(in_p + out_p),
                duration_ms = _safe_float(row.get("FLOW_DURATION_MILLISECONDS")),
                bytes_in   = int(in_b),
                bytes_out  = int(out_b),
                packets_in = int(in_p),
                packets_out = int(out_p),
                tcp_flags  = int(row.get("TCP_FLAGS", 0)),
                all_features = {
                    col: _safe_float(row.get(col))
                    for col in row.index
                    if col not in ["IPV4_SRC_ADDR", "IPV4_DST_ADDR", "Label"]
                },
                # No ground_truth_label — pre-warm flows must not affect metrics
                ground_truth_label = None,
            )
            batch.append(record)

        # Process in one batch — avoids 600 individual HTTP round-trips
        stream_processor.process_flows(batch)

        buf_size = stream_processor.buffer.get_size()
        logger.info(
            "Pre-warm complete. Buffer size: %d / %d flows ready.",
            buf_size,
            n_flows,
        )

        if buf_size < 512:
            logger.warning(
                "Pre-warm buffer is below window_size (512). "
                "Dashboard will still have a short blank period. "
                "Increase n_flows in the _prewarm_buffer call."
            )

    except Exception as e:
        logger.warning(
            "Pre-warm failed with error: %s. "
            "Dashboard will have a blank period at startup.",
            e,
            exc_info=True,
        )
        # Non-fatal — backend starts normally, just without the pre-warm benefit


# ---------------------------------------------------------------------------
# Repository and Dataset Configuration
# ---------------------------------------------------------------------------
# Repository root — two directories above project/backend/serve.py
REPO_ROOT = Path(__file__).resolve().parents[2]

# Dataset for buffer pre-warming
PREWARM_DATASET_NAME = "NF-UNSW-NB15-v3"
PREWARM_CSV_PATH = REPO_ROOT / "data" / PREWARM_DATASET_NAME / f"{PREWARM_DATASET_NAME}.csv"


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
app = None
inference_engine: Optional[InferenceEngine] = None
stream_processor: Optional[StreamProcessor] = None
start_time: Optional[float] = None
request_count: int = 0
error_count: int = 0
stream_control: dict = {
    "is_active": True,
    "ingestion_rate": 1.0,
    "updated_at": 0.0,
}
stream_process = None  # subprocess.Popen for stream_from_dataset.py


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global inference_engine, stream_processor, start_time, request_count, error_count, stream_control

    start_time = time.time()
    request_count = 0
    error_count = 0
    stream_control = {
        "is_active": True,
        "ingestion_rate": 1.0,
        "updated_at": start_time,
    }

    config = load_config()
    settings = Settings()

    # ── Model paths ────────────────────────────────────────────────────────
    model_config = config.get("model", {})
    model_checkpoint = model_config.get("checkpoint_path", settings.model_checkpoint_path)
    model_scaler     = model_config.get("scaler_path",     settings.model_scaler_path)
    model_device     = model_config.get("device",          settings.model_device)

    # Use module-level REPO_ROOT instead of recomputing
    if not Path(model_checkpoint).is_absolute():
        model_checkpoint = str(REPO_ROOT / model_checkpoint)
    if not Path(model_scaler).is_absolute():
        model_scaler = str(REPO_ROOT / model_scaler)

    # ── Inference engine ───────────────────────────────────────────────────
    try:
        logger.info("Initializing inference engine...")
        inference_engine = InferenceEngine(
            checkpoint_path=model_checkpoint,
            scaler_path=model_scaler,
            device=model_device,
            model_config=model_config,
        )
        inference_engine._trained_threshold = inference_engine.threshold
        logger.info("✓ Inference engine loaded (threshold=%.6f)", inference_engine.threshold)
    except Exception as e:
        logger.error("Failed to initialize inference engine: %s", e, exc_info=True)
        raise

    # ── Stream processor ───────────────────────────────────────────────────
    streaming_config = config.get("streaming", {})
    # Always read window_size from streaming config; default is 512 to match
    # the trained model. A stale config_dashboard.yaml with window_size: 32
    # will cause silent shape mismatches — warn loudly if that happens.
    window_size  = int(streaming_config.get("window_size",  settings.window_size))
    step_percent = float(streaming_config.get("step_percent", settings.step_percent))
    buffer_size  = int(streaming_config.get("buffer_size",  settings.buffer_size))

    if window_size != 512:
        logger.warning(
            "window_size=%d in config differs from the trained model's 512. "
            "Reconstruction errors will be computed on mismatched sequence "
            "lengths and the threshold will not be valid.",
            window_size,
        )

    try:
        logger.info("Initializing stream processor (window_size=%d)...", window_size)
        stream_processor = StreamProcessor(
            inference_engine=inference_engine,
            window_size=window_size,
            step_percent=step_percent,
            buffer_size=buffer_size,
        )
        logger.info("✓ Stream processor initialized")

        # Pre-warm disabled for tests — incoming stream will fill buffer naturally.
        logger.info("Pre-warm disabled: not seeding buffer; streaming will fill buffer on demand.")

    except Exception as e:
        logger.error("Failed to initialize stream processor: %s", e, exc_info=True)
        raise

    yield

    logger.info("Shutting down...")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="GraphIDS Real-Time Dashboard API",
    description="API for real-time IDS using GraphIDS model",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================================================================
# Endpoints
# ===========================================================================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check() -> HealthResponse:
    """System health check."""
    status = "healthy"
    message = ""

    if inference_engine is None or not inference_engine.is_loaded:
        status = "degraded"
        message = "Inference engine not loaded"
    if stream_processor is None:
        status = "degraded"
        message = "Stream processor not initialized"

    return HealthResponse(
        status=status,
        model_loaded=inference_engine is not None and inference_engine.is_loaded,
        scaler_loaded=inference_engine is not None and inference_engine.scaler is not None,
        message=message,
    )


@app.post("/classify", response_model=FlowBatchResponse, tags=["Inference"])
async def classify_flows(request: FlowBatchRequest) -> FlowBatchResponse:
    """Classify a batch of NetFlow records."""
    global stream_processor, request_count, error_count

    request_count += 1

    if stream_processor is None:
        error_count += 1
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    try:
        t0 = time.time()
        results = stream_processor.process_flows(request.flows)
        processing_time = (time.time() - t0) * 1000

        return FlowBatchResponse(
            classifications=results,
            batch_id=f"batch_{request_count}",
            processed_count=len(request.flows),
            error_count=0,
            total_time_ms=processing_time,
            model_version=inference_engine.model_version if inference_engine else "unknown",
        )

    except Exception as e:
        error_count += 1
        logger.error("Classification error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Classification failed: {e}")


@app.get("/events", response_model=list[ClassificationResult], tags=["Monitoring"])
async def get_recent_events(
    limit: int = Query(50, ge=1, le=1000),
    min_score: float = Query(0.0, ge=0.0, le=1.0),
    label: Optional[int] = Query(None, ge=0, le=1),
) -> list[ClassificationResult]:
    """Return recent classification events with optional filtering."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    try:
        return stream_processor.get_recent_events(
            limit=limit, min_score=min_score, label_filter=label
        )
    except Exception as e:
        logger.error("Error retrieving events: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats", response_model=DashboardStats, tags=["Monitoring"])
async def get_statistics() -> DashboardStats:
    """Return dashboard statistics."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    try:
        stats = stream_processor.get_stats()
        uptime = (time.time() - start_time) if start_time else 0.0

        current_window_id = int(stats["total_heartbeats"])

        return DashboardStats(
            total_flows_processed=int(stats.get("total_flows_processed", 0)),
            total_anomalies_detected=int(stats.get("total_anomalies_detected", 0)),
            anomaly_rate=float(stats.get("anomaly_rate", 0.0)),
            avg_anomaly_score=float(stats.get("avg_anomaly_score", 0.0)),
            current_window_id=current_window_id,
            model_version=inference_engine.model_version if inference_engine else "unknown",
            uptime_seconds=uptime,
            node_count=int(stats.get("node_count", 0)),
            buffer_size=int(stats.get("buffer_size", 0)),
            true_positives=int(stats.get("true_positives", 0)),
            false_positives=int(stats.get("false_positives", 0)),
            true_negatives=int(stats.get("true_negatives", 0)),
            false_negatives=int(stats.get("false_negatives", 0)),
            fpr=float(stats.get("fpr", 0.0)),
            tpr=float(stats.get("tpr", 0.0)),
            precision=float(stats.get("precision", 0.0)),
            f1_score=float(stats.get("f1_score", 0.0)),
            retraining_threshold_fpr=stats.get("retraining_threshold_fpr", None),
            should_retrain=bool(stats.get("should_retrain", False)),
            windowed_fpr=float(stats.get("windowed_fpr", 0.0)),
            windowed_tpr=float(stats.get("windowed_tpr", 0.0)),
            windowed_precision=float(stats.get("windowed_precision", 0.0)),
            windowed_f1=float(stats.get("windowed_f1", 0.0)),
            windowed_window_sec=int(stats.get("windowed_window_sec", 300)),
            windowed_event_count=int(stats.get("windowed_event_count", 0)),
            alert_active=bool(stats.get("alert_active", False)),
            alert_triggered_at=stats.get("alert_triggered_at", None),
            alert_fpr_value=stats.get("alert_fpr_value", None),
            alert_threshold=stats.get("alert_threshold", None),
        )

    except Exception as e:
        logger.error("Error retrieving stats: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/model-info", tags=["System"])
async def get_model_info() -> dict:
    """Return model metadata and configuration."""
    if inference_engine is None:
        raise HTTPException(status_code=503, detail="Inference engine not initialized")
    info = inference_engine.get_model_info()
    info["calibration_phase"] = stream_processor.calibrator._phase
    return info


@app.post("/retraining-threshold", tags=["Configuration"])
async def set_retraining_threshold(
    threshold_fpr: float = Query(..., ge=0.0, le=1.0),
) -> dict:
    """Set the FPR threshold above which retraining is recommended."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    try:
        stream_processor.set_retraining_threshold(threshold_fpr)
        return {
            "status": "success",
            "message": f"Retraining threshold FPR set to {threshold_fpr}",
            "threshold_fpr": threshold_fpr,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error setting retraining threshold: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/retraining-threshold", tags=["Configuration"])
async def get_retraining_threshold() -> dict:
    """Get the current retraining threshold FPR."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    return {
        "threshold_fpr": stream_processor.retraining_threshold_fpr,
        "is_set": stream_processor.retraining_threshold_fpr is not None,
    }


@app.get("/alert", tags=["Monitoring"])
async def get_alert_status() -> dict:
    """Get current retraining alert status for dashboard polling."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    windowed = stream_processor.get_windowed_stats()

    return {
        "alert_active": stream_processor._alert_active,
        "alert_triggered_at": stream_processor._alert_triggered_at,
        "alert_fpr_value": stream_processor._alert_fpr_value,
        "alert_threshold": stream_processor._alert_threshold,
        "windowed_fpr": windowed["fpr"],
        "windowed_stats": windowed,
        "message": (
            stream_processor._alert_history[-1]["message"]
            if stream_processor._alert_active and stream_processor._alert_history
            else None
        ),
        "recent_alerts": [
            {
                "alert_id": a["alert_id"],
                "triggered_at": a["triggered_at"],
                "windowed_fpr": a["windowed_fpr"],
                "threshold": a["threshold"],
            }
            for a in list(stream_processor._alert_history)[-10:]
        ],
    }


@app.post("/alert/acknowledge", tags=["Monitoring"])
async def acknowledge_alert() -> dict:
    """Acknowledge and clear the active retraining alert."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    was_active = stream_processor.acknowledge_alert()

    if was_active:
        return {
            "status": "acknowledged",
            "message": "Alert acknowledged. System will re-alert if FPR rises again.",
        }
    return {
        "status": "no_active_alert",
        "message": "No active alert to acknowledge.",
    }


@app.post("/alert/threshold", tags=["Monitoring"])
async def set_alert_threshold(
    threshold_fpr: float = Query(..., ge=0.0, le=1.0),
    window_sec: int = Query(300, ge=60, le=3600),
) -> dict:
    """Set alert threshold and rolling window duration."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    stream_processor.set_retraining_threshold(threshold_fpr)
    stream_processor._fpr_window_sec = window_sec

    return {
        "status": "set",
        "threshold_fpr": threshold_fpr,
        "window_sec": window_sec,
        "message": (
            f"Alert will fire when windowed FPR exceeds {threshold_fpr:.2%} "
            f"over any {window_sec}s window."
        ),
    }


@app.get("/subgraph/{flow_id}", tags=["Visualization"])
async def get_flow_subgraph(flow_id: str) -> dict:
    """Return a 2-hop neighborhood graph centered on the flow's src/dst IPs."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    target_flow = None
    for event in stream_processor.recent_events:
        if event.flow_id == flow_id:
            target_flow = event
            break

    if target_flow is None:
        raise HTTPException(status_code=404, detail=f"Flow {flow_id} not found")

    center_ips = {target_flow.src_ip, target_flow.dst_ip}
    nodes: dict = {}
    edges: list = []

    for meta in stream_processor.buffer.flow_metadata:
        src = meta["src_ip"]
        dst = meta["dst_ip"]

        if src in center_ips or dst in center_ips:
            nodes.setdefault(src, {"id": src, "label": src, "hop": 1})
            nodes.setdefault(dst, {"id": dst, "label": dst, "hop": 1})
            edges.append({
                "source": src,
                "target": dst,
                "ground_truth": meta.get("ground_truth_label"),
            })

    for ip in center_ips:
        if ip in nodes:
            nodes[ip]["hop"] = 0
            nodes[ip]["is_center"] = True

    return {
        "flow_id":    flow_id,
        "center_ips": list(center_ips),
        "nodes":      list(nodes.values()),
        "edges":      edges[:200],
        "node_count": len(nodes),
        "edge_count": len(edges),
    }


@app.get("/metrics", tags=["System"])
async def get_metrics() -> dict:
    """Return API-level metrics (request count, error rate, uptime)."""
    global request_count, error_count

    uptime = (time.time() - start_time) if start_time else 0.0
    return {
        "uptime_seconds": uptime,
        "total_requests": request_count,
        "total_errors":   error_count,
        "error_rate":     error_count / max(request_count, 1),
    }


@app.get("/stream-control", tags=["Configuration"])
async def get_stream_control() -> dict:
    """Get current stream control state for the external streamer process."""
    return {
        "is_active":      bool(stream_control.get("is_active", True)),
        "ingestion_rate": float(stream_control.get("ingestion_rate", 1.0)),
        "updated_at":     float(stream_control.get("updated_at", time.time())),
    }


@app.post("/stream-control", tags=["Configuration"])
async def update_stream_control(
    is_active: Optional[bool] = Query(None),
    ingestion_rate: Optional[float] = Query(None, ge=0.25, le=4.0),
) -> dict:
    """Update stream control state for the dataset streamer process."""
    global stream_control

    if is_active is None and ingestion_rate is None:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'is_active' or 'ingestion_rate' must be provided.",
        )

    if is_active is not None:
        stream_control["is_active"] = bool(is_active)
    if ingestion_rate is not None:
        stream_control["ingestion_rate"] = float(ingestion_rate)
    stream_control["updated_at"] = time.time()

    return {
        "status":         "success",
        "is_active":      bool(stream_control["is_active"]),
        "ingestion_rate": float(stream_control["ingestion_rate"]),
        "updated_at":     float(stream_control["updated_at"]),
    }


@app.post("/reset", tags=["System"])
async def reset_processor() -> dict:
    """Reset stream processor buffers and counters."""
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    try:
        # ── Stream processor state ─────────────────────────────────────
        stream_processor.buffer.clear()
        stream_processor.total_flows      = 0
        stream_processor.total_anomalies  = 0
        if hasattr(stream_processor, "total_heartbeats"):
            stream_processor.total_heartbeats = 0
        stream_processor.recent_events.clear()
        if hasattr(stream_processor, "_pending_flows_for_gt"):
            stream_processor._pending_flows_for_gt = []

        # Confusion matrix
        stream_processor.true_positives  = 0
        stream_processor.false_positives = 0
        stream_processor.true_negatives  = 0
        stream_processor.false_negatives = 0
        stream_processor.has_ground_truth = False

        # Windowed tracking
        stream_processor._windowed_events.clear()

        # Alert state
        stream_processor._alert_active        = False
        stream_processor._alert_triggered_at  = None
        stream_processor._alert_fpr_value     = None
        stream_processor._alert_threshold     = None
        stream_processor._alert_history.clear()

        # ── Inference engine state ─────────────────────────────────────
        # Only touch fields that still exist after the inference.py rewrite.
        # DO NOT reference removed adaptive-state fields.
        inference_engine.window_buffer  = []
        inference_engine.last_emit_time = time.time()
        inference_engine.reset_normalizer()   # resets SKIP/LEARN/SCORE + EMA

        stream_processor.calibrator.reset()
        if hasattr(inference_engine, '_sigmoid_scale'):
             del inference_engine._sigmoid_scale
        if hasattr(inference_engine, '_trained_threshold'):
             inference_engine.threshold = inference_engine._trained_threshold


        return {
            "status": "reset",
            "message": "Stream processor reset successfully. Pre-warm disabled.",
        }

    except Exception as e:
        logger.error("Error resetting processor: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stream/start", tags=["System"])
async def start_stream() -> dict:
    """Start the streaming process (python stream_from_dataset.py --no-warmup)."""
    global stream_process

    if stream_process is not None and stream_process.poll() is None:
        return {
            "status": "already_running",
            "message": "Streaming process is already running.",
            "pid": stream_process.pid,
        }

    try:
        # Start the streaming subprocess without the stale phase-aware gate.
        # The new inference contract no longer exposes a normalizer phase,
        # so the streamer must not wait for SCORE that can never arrive.
        stream_process = subprocess.Popen(
            ["python", "stream_from_dataset.py", "--no-warmup"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        
        logger.info("Started streaming process with PID %d (no-warmup only)", stream_process.pid)
        return {
            "status": "started",
            "message": "Streaming process started successfully (no-warmup only).",
            "pid": stream_process.pid,
        }
    except Exception as e:
        logger.error("Failed to start streaming process: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start stream: {str(e)}")


@app.post("/stream/stop", tags=["System"])
async def stop_stream() -> dict:
    """Stop the streaming process."""
    global stream_process

    if stream_process is None or stream_process.poll() is not None:
        return {
            "status": "not_running",
            "message": "Streaming process is not running.",
        }

    try:
        # Terminate the streaming subprocess
        stream_process.terminate()
        try:
            stream_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            stream_process.kill()
            stream_process.wait()
        
        logger.info("Stopped streaming process")
        stream_process = None
        return {
            "status": "stopped",
            "message": "Streaming process stopped successfully.",
        }
    except Exception as e:
        logger.error("Failed to stop streaming process: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to stop stream: {str(e)}")


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    global error_count
    error_count += 1
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail":     "Internal server error",
            "error_code": "INTERNAL_ERROR",
            "timestamp":  datetime.utcnow().isoformat(),
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    config = load_config()
    api_config = config.get("api", {})

    host    = api_config.get("host",    "127.0.0.1")
    port    = api_config.get("port",    8000)
    debug   = api_config.get("debug",   False)
    workers = api_config.get("workers", 1)

    logger.info("Starting server on %s:%d", host, port)
    uvicorn.run(
        "serve:app",
        host=host,
        port=port,
        reload=debug,
        workers=workers,
        log_level="info",
    )