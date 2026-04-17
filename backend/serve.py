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

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic_settings import BaseSettings

# Import custom modules
from models import (
    FlowBatchRequest, FlowBatchResponse, ClassificationResult,
    EventsRequest, DashboardStats, HealthResponse, ErrorResponse
)
from inference import InferenceEngine
from stream import StreamProcessor

# Configure logging (default to WARNING to reduce noise; can be overridden
# via LOG_LEVEL environment variable, e.g. LOG_LEVEL=INFO for debugging).
log_level_name = os.getenv("LOG_LEVEL", "WARNING").upper()
log_level = getattr(logging, log_level_name, logging.WARNING)

logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Configuration settings from YAML."""
    
    # Model
    model_checkpoint_path: str = "../../models/GraphIDS_NF-UNSW-NB15-v3_42.ckpt"
    model_scaler_path: str = "../../models/NF-UNSW-NB15-v3/scaler.pkl"
    model_device: str = "cuda"
    
    # Streaming
    window_size: int = 32
    step_percent: float = 0.5
    buffer_size: int = 1000
    
    # API
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    api_workers: int = 1
    api_debug: bool = False
    
    # Advanced
    recent_events_size: int = 500
    max_nodes: int = 100000
    
    class Config:
        env_file = ".env"


def load_config(config_path: Optional[str] = None) -> dict:
    """Load configuration from YAML file."""
    if config_path is None:
        # Try to find config in common locations
        possible_paths = [
            Path("config_dashboard.yaml"),
            Path("../config_dashboard.yaml"),
            Path("../../config_dashboard.yaml"),
        ]
        for p in possible_paths:
            if p.exists():
                config_path = str(p)
                break
    
    if config_path and Path(config_path).exists():
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)
        logger.info(f"Loaded config from {config_path}")
        return config
    else:
        logger.warning("No config file found; using defaults")
        return {}


# Global state
app = None
inference_engine: Optional[InferenceEngine] = None
stream_processor: Optional[StreamProcessor] = None
start_time: Optional[float] = None
request_count: int = 0
error_count: int = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown."""
    global inference_engine, stream_processor, start_time, request_count, error_count
    
    start_time = time.time()
    request_count = 0
    error_count = 0
    
    # Load config
    config = load_config()
    # Load default settings (can be overridden by config)
    settings = Settings()
    
    # Extract model config
    model_config = config.get("model", {})
    model_checkpoint = model_config.get("checkpoint_path", settings.model_checkpoint_path)
    model_scaler = model_config.get("scaler_path", settings.model_scaler_path)
    model_device = model_config.get("device", settings.model_device)
    
    # Make paths relative to the project root (GraphIDS repo), not just the
    # dashboard folder. This ensures we reuse the same checkpoints and
    # scaler generated during training under the main project.
    repo_root = Path(__file__).resolve().parents[2]
    if not Path(model_checkpoint).is_absolute():
        model_checkpoint = str(repo_root / model_checkpoint)
    if not Path(model_scaler).is_absolute():
        model_scaler = str(repo_root / model_scaler)
    
    try:
        logger.info("Initializing inference engine...")
        inference_engine = InferenceEngine(
            checkpoint_path=model_checkpoint,
            scaler_path=model_scaler,
            device=model_device,
            model_config=model_config,
        )
        logger.info("✓ Inference engine loaded")
        
        # Initialize stream processor
        streaming_config = config.get("streaming", {})
        window_size = streaming_config.get("window_size", 32)
        step_percent = streaming_config.get("step_percent", 0.5)
        buffer_size = streaming_config.get("buffer_size", 1000)
        
        logger.info("Initializing stream processor...")
        stream_processor = StreamProcessor(
            inference_engine=inference_engine,
            window_size=window_size,
            step_percent=step_percent,
            buffer_size=buffer_size,
        )
        logger.info("✓ Stream processor initialized")
        
    except Exception as e:
        logger.error(f"Failed to initialize: {e}", exc_info=True)
        raise
    
    yield
    
    # Cleanup
    logger.info("Shutting down...")


# Create FastAPI app
app = FastAPI(
    title="GraphIDS Real-Time Dashboard API",
    description="API for real-time IDS using GraphIDS model",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check() -> HealthResponse:
    """Health check endpoint."""
    global inference_engine, stream_processor
    
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
    """
    Classify a batch of flows.
    
    Takes raw NetFlow records and returns classification results
    with anomaly scores and labels.
    """
    global stream_processor, request_count, error_count
    
    request_count += 1
    
    if stream_processor is None:
        error_count += 1
        raise HTTPException(
            status_code=503,
            detail="Stream processor not initialized",
        )
    
    try:
        import time
        start = time.time()
        
        # Process flows
        results = stream_processor.process_flows(request.flows)
        
        processing_time = (time.time() - start) * 1000
        
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
        logger.error(f"Classification error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Classification failed: {str(e)}",
        )


@app.get("/events", response_model=list[ClassificationResult], tags=["Monitoring"])
async def get_recent_events(
    limit: int = Query(50, ge=1, le=1000),
    min_score: float = Query(0.0, ge=0.0, le=1.0),
    label: Optional[int] = Query(None, ge=0, le=1),
) -> list[ClassificationResult]:
    """
    Get recent classification events.
    
    Query parameters:
    - limit: Number of events to return (default 50)
    - min_score: Filter by minimum anomaly score
    - label: Filter by label (0=benign, 1=anomalous)
    """
    global stream_processor
    
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")
    
    try:
        events = stream_processor.get_recent_events(
            limit=limit,
            min_score=min_score,
            label_filter=label,
        )
        return events
    except Exception as e:
        logger.error(f"Error retrieving events: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats", response_model=DashboardStats, tags=["Monitoring"])
async def get_statistics() -> DashboardStats:
    """Get dashboard statistics."""
    global stream_processor, start_time
    
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")
    
    try:
        stats = stream_processor.get_stats()
        
        uptime = (time.time() - start_time) if start_time else 0
        
        return DashboardStats(
            total_flows_processed=stats["total_flows_processed"],
            total_anomalies_detected=stats["total_anomalies_detected"],
            anomaly_rate=stats["anomaly_rate"],
            avg_anomaly_score=stats["avg_anomaly_score"],
            current_window_id=stats["current_window_id"],
            model_version=inference_engine.model_version if inference_engine else "unknown",
            uptime_seconds=uptime,
            node_count=stats["node_count"],
            buffer_size=stats["buffer_size"],
        )
    except Exception as e:
        logger.error(f"Error retrieving stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/model-info", tags=["System"])
async def get_model_info() -> dict:
    """Get model metadata and configuration."""
    global inference_engine
    
    if inference_engine is None:
        raise HTTPException(status_code=503, detail="Inference engine not initialized")
    
    return inference_engine.get_model_info()


@app.get("/metrics", tags=["System"])
async def get_metrics() -> dict:
    """Get API metrics and health indicators."""
    global request_count, error_count
    
    uptime = (time.time() - start_time) if start_time else 0
    
    return {
        "uptime_seconds": uptime,
        "total_requests": request_count,
        "total_errors": error_count,
        "error_rate": error_count / max(request_count, 1),
    }


@app.post("/reset", tags=["System"])
async def reset_processor() -> dict:
    """Reset the stream processor (clear buffers, reset counters)."""
    global stream_processor
    
    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")
    
    try:
        stream_processor.buffer.clear()
        stream_processor.total_flows = 0
        stream_processor.total_anomalies = 0
        stream_processor.recent_events.clear()
        
        return {"status": "reset", "message": "Stream processor reset successfully"}
    except Exception as e:
        logger.error(f"Error resetting processor: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for unhandled errors."""
    global error_count
    error_count += 1
    
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error_code": "INTERNAL_ERROR",
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


if __name__ == "__main__":
    import uvicorn
    
    config = load_config()
    api_config = config.get("api", {})
    
    host = api_config.get("host", "127.0.0.1")
    port = api_config.get("port", 8000)
    debug = api_config.get("debug", False)
    workers = api_config.get("workers", 1)
    
    logger.info(f"Starting server on {host}:{port}")
    
    uvicorn.run(
        "serve:app",
        host=host,
        port=port,
        reload=debug,
        workers=workers,
        log_level="info",
    )
