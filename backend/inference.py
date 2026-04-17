"""Model loading and inference wrapper for the dashboard.

This module adapts the trained GraphIDS model for real-time inference.
It loads the same checkpoint used during training and exposes a minimal
interface (scale → encode → reconstruct → score) for the streaming
pipeline in ``stream.py``.
"""

import os
import pickle
import logging
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import sys
from importlib.util import spec_from_file_location, module_from_spec

import torch

logger = logging.getLogger(__name__)


# Resolve the core GraphIDS model from the main repo (../.. / models / graphids.py)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
GRAPHIDS_PATH = PROJECT_ROOT / "models" / "graphids.py"

if not GRAPHIDS_PATH.exists():
    raise ImportError(f"Expected GraphIDS definition at {GRAPHIDS_PATH}, but file was not found.")

spec = spec_from_file_location("graphids_core", str(GRAPHIDS_PATH))
if spec is None or spec.loader is None:
    raise ImportError(f"Could not load spec for GraphIDS module at {GRAPHIDS_PATH}.")

_graphids_module = module_from_spec(spec)
sys.modules["graphids_core"] = _graphids_module
spec.loader.exec_module(_graphids_module)  # type: ignore[arg-type]
GraphIDS = _graphids_module.GraphIDS

class InferenceEngine:
    """Wrapper for GraphIDS model inference."""
    
    def __init__(
        self,
        checkpoint_path: str,
        scaler_path: str,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        model_config: dict = None,
    ):
        """
        Initialize inference engine.
        
        Args:
            checkpoint_path: Path to .ckpt file
            scaler_path: Path to scaler.pkl
            device: torch device
            model_config: Dict with model hyperparameters
        """
        self.checkpoint_path = Path(checkpoint_path)
        self.scaler_path = Path(scaler_path)
        self.device = torch.device(device)
        self.model_config = model_config or {}
        
        self.model = None
        self.scaler = None
        self.threshold = None
        self.is_loaded = False
        self.model_version = "unknown"
        
        # Rolling buffer for normalization: track recent reconstruction errors
        # to provide context when normalizing scores
        from collections import deque
        self.recent_errors = deque(maxlen=1000)  # Keep last 1000 errors
        
        self._load_assets()
    
    def _load_assets(self):
        """Load scaler and initialize GraphIDS from checkpoint.

        - Loads the MinMaxScaler used during training.
        - Builds a ``GraphIDS`` instance with hyperparameters from
          ``config_dashboard.yaml`` (``model_config``).
        - Loads the trained weights and threshold from the
          ``GraphIDS_NF-UNSW-NB15-v3_42.ckpt`` checkpoint.
        """

        # -----------------------
        # 1) Load scaler (best-effort)
        # -----------------------
        if self.scaler_path.exists():
            try:
                with open(self.scaler_path, "rb") as f:
                    self.scaler = pickle.load(f)
                logger.info("Loaded scaler from %s", self.scaler_path)
            except Exception as e:  # pragma: no cover - defensive
                logger.error(
                    "Failed to load scaler from %s: %s. Proceeding without scaler.",
                    self.scaler_path,
                    e,
                    exc_info=True,
                )
                self.scaler = None
        else:
            logger.warning("Scaler not found at %s", self.scaler_path)

        # -----------------------
        # 2) Build GraphIDS model
        # -----------------------
        cfg = self.model_config

        # Edge feature dimension: prefer scaler metadata, fall back to config
        if self.scaler is not None and hasattr(self.scaler, "n_features_in_"):
            edim_in = int(self.scaler.n_features_in_)
        else:
            edim_in = int(cfg.get("edim_in")) if cfg.get("edim_in") is not None else 0

        if edim_in <= 0:
            raise RuntimeError(
                "Cannot determine edim_in for GraphIDS. Ensure scaler.pkl is "
                "available or 'edim_in' is set in the model section of "
                "config_dashboard.yaml."
            )
        # During training for NF-UNSW-NB15-v3, the node feature dimension
        # (ndim_in) matched the edge feature dimension (edim_in). To ensure
        # the checkpoint loads cleanly, we enforce the same relationship
        # here rather than honoring any divergent config value.
        ndim_in = edim_in
        edim_out = int(cfg.get("edim_out", 128))
        embed_dim = int(cfg.get("embed_dim", 256))
        num_heads = int(cfg.get("num_heads", 4))
        num_layers = int(cfg.get("num_layers", 4))
        dropout = float(cfg.get("dropout", 0.0))
        ae_dropout = float(cfg.get("ae_dropout", 0.1))
        window_size = int(cfg.get("window_size", 32))
        positional_encoding = cfg.get("positional_encoding", "learnable")
        agg_type = cfg.get("agg_type", "mean")
        mask_ratio = float(cfg.get("mask_ratio", 0.0))

        self.model = GraphIDS(
            ndim_in=ndim_in,
            edim_in=edim_in,
            edim_out=edim_out,
            embed_dim=embed_dim,
            num_heads=num_heads,
            num_layers=num_layers,
            window_size=window_size,
            dropout=dropout,
            ae_dropout=ae_dropout,
            positional_encoding=positional_encoding,
            agg_type=agg_type,
            mask_ratio=mask_ratio,
        ).to(self.device)

        # -----------------------
        # 3) Load checkpoint (required)
        # -----------------------
        if self.checkpoint_path.exists():
            try:
                # Reuse GraphIDS.load_checkpoint to keep semantics identical
                epoch, threshold = self.model.load_checkpoint(str(self.checkpoint_path))
                self.threshold = threshold
                if self.threshold is not None:
                    logger.info("Loaded threshold from checkpoint: %s", self.threshold)
                logger.info("Loaded GraphIDS checkpoint from %s (epoch %s)", self.checkpoint_path, epoch)

                # Optional: expose a simple model_version tag
                self.model_version = cfg.get("model_version", "GraphIDS_NF-UNSW-NB15-v3")
                self.is_loaded = True
            except Exception as e:  # pragma: no cover - defensive
                logger.error(
                    "Failed to load model checkpoint from %s: %s",
                    self.checkpoint_path,
                    e,
                    exc_info=True,
                )
                raise
        else:
            logger.error("Checkpoint not found at %s", self.checkpoint_path)
            raise FileNotFoundError(f"Checkpoint not found: {self.checkpoint_path}")
    
    def scale_features(self, features: np.ndarray) -> np.ndarray:
        """
        Scale raw features using fitted scaler.
        
        Args:
            features: [num_edges, num_features]
            
        Returns:
            Scaled features: [num_edges, num_features]
        """
        if self.scaler is None:
            logger.warning("Scaler not loaded; returning raw features")
            return features
        
        scaled = self.scaler.transform(features)
        # Clip to safe range (as in training)
        scaled = np.clip(scaled, -10, 10)
        return scaled
    
    def encode_edges(
        self,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor,
        num_nodes: int,
    ) -> torch.Tensor:
        """
        Encode edges using GraphIDS encoder (SAGELayer).
        
        Args:
            edge_index: [2, num_edges] edge indices
            edge_attr: [num_edges, edim_in] edge features
            num_nodes: number of nodes
            
        Returns:
            Edge embeddings: [num_edges, edim_out]
        """
        if not self.is_loaded or self.model is None:
            raise RuntimeError("GraphIDS model not loaded")

        with torch.no_grad():
            edge_couples = edge_index.t().contiguous()
            edge_emb = self.model.encoder(
                edge_index=edge_index,
                edge_attr=edge_attr,
                edge_couples=edge_couples,
                num_nodes=num_nodes,
            )

        return edge_emb
    
    def reconstruct_sequence(
        self,
        edge_embeddings: torch.Tensor,
        padding_mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Reconstruct edge embeddings using transformer.
        
        Args:
            edge_embeddings: [batch_size, window_size, edim_out]
            padding_mask: [batch_size, window_size] or None
            
        Returns:
            reconstructed: [batch_size, window_size, edim_out]
            errors: [batch_size] reconstruction errors
        """
        if not self.is_loaded or self.model is None:
            raise RuntimeError("GraphIDS model not loaded")

        with torch.no_grad():
            reconstructed = self.model.transformer(edge_embeddings, padding_mask)

            # Compute per-sequence MSE reconstruction error
            if padding_mask is not None:
                # Only compute error on valid positions
                mask = padding_mask.unsqueeze(-1)  # [batch, window, 1]
                errors = torch.sum(
                    ((edge_embeddings - reconstructed) ** 2) * mask,
                    dim=(1, 2),
                ) / (torch.sum(mask, dim=(1, 2)) + 1e-8)
            else:
                errors = torch.mean((edge_embeddings - reconstructed) ** 2, dim=(1, 2))

        return reconstructed, errors
    
    def compute_anomaly_score(
        self,
        errors: torch.Tensor,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Convert reconstruction errors to anomaly scores and labels.
        
        Args:
            errors: [batch_size] reconstruction errors
            
        Returns:
            scores: [batch_size] anomaly scores (0-1) normalized against
                    recent error history for good discrimination
            labels: [batch_size] binary predictions (0 or 1)
        """
        # Raw reconstruction errors as NumPy
        errors_np = errors.cpu().numpy().astype(float)

        if errors_np.size == 0:
            return np.array([], dtype=np.float32), np.array([], dtype=int)

        # --- Binary labels (model decision) ---
        # Start from the checkpoint threshold so behavior matches the
        # offline pipeline. If no threshold was saved, fall back to
        # the batch median.
        if self.threshold is not None:
            base_threshold = float(self.threshold)
        else:
            base_threshold = float(np.median(errors_np))

        threshold = base_threshold

        # If the checkpoint threshold is clearly misaligned with the
        # current distribution (almost everything on one side), adjust
        # it using a percentile-based fallback so that only the most
        # extreme errors are treated as anomalies.
        above_ratio = float((errors_np > base_threshold).mean())
        below_ratio = float((errors_np <= base_threshold).mean())

        if above_ratio > 0.99:
            threshold = float(np.quantile(errors_np, 0.99))
        elif below_ratio > 0.99:
            threshold = float(np.quantile(errors_np, 0.01))

        labels = (errors_np > threshold).astype(int)

        # --- Scores for visualization: Min-Max normalization against rolling buffer ---
        # Add current errors to rolling buffer for historical context
        # --- Robust normalization using Median + MAD ---
        self.recent_errors.extend(errors_np)

        recent_array = np.array(list(self.recent_errors))

        median = np.median(recent_array)
        mad = np.median(np.abs(recent_array - median)) + 1e-8

        # Robust Z-score
        z_scores = (errors_np - median) / (1.4826 * mad)

        # Map to [0,1] for visualization
        scores_normalized = 1 / (1 + np.exp(-z_scores))

        return scores_normalized.astype(np.float32), labels
    
    def get_model_info(self) -> dict:
        """Get model metadata."""
        return {
            "version": self.model_version,
            "loaded": self.is_loaded,
            "scaler_loaded": self.scaler is not None,
            "threshold": float(self.threshold) if self.threshold is not None else None,
            "device": str(self.device),
        }
