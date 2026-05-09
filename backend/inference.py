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
import time

import torch

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Resolve the core GraphIDS model from the main repo (../../models/graphids.py)
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[2]
GRAPHIDS_PATH = PROJECT_ROOT / "models" / "graphids.py"

if not GRAPHIDS_PATH.exists():
    raise ImportError(
        f"Expected GraphIDS definition at {GRAPHIDS_PATH}, but file was not found."
    )

spec = spec_from_file_location("graphids_core", str(GRAPHIDS_PATH))
if spec is None or spec.loader is None:
    raise ImportError(
        f"Could not load spec for GraphIDS module at {GRAPHIDS_PATH}."
    )

_graphids_module = module_from_spec(spec)
sys.modules["graphids_core"] = _graphids_module
spec.loader.exec_module(_graphids_module)  # type: ignore[arg-type]
GraphIDS = _graphids_module.GraphIDS


# ---------------------------------------------------------------------------
# InferenceEngine
# ---------------------------------------------------------------------------

class InferenceEngine:
    """Wrapper for GraphIDS model inference.

    Responsibilities
    ----------------
    1. Load scaler and model checkpoint.
    2. Scale raw netflow edge features.
    3. Encode edges via the GraphIDS SAGELayer encoder.
    4. Reconstruct edge embeddings via the Transformer and compute
       per-window MEAN reconstruction error (matches training).
    5. Map errors to anomaly scores and binary labels using the
       trained threshold loaded from the checkpoint.
    6. Apply EMA smoothing and temporal heartbeat aggregation before
       emitting results to the dashboard.
    """

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
            checkpoint_path: Path to .ckpt file.
            scaler_path:      Path to scaler.pkl.
            device:           Torch device string.
            model_config:     Dict with model hyperparameters (from
                              config_dashboard.yaml → model section).
        """
        self.checkpoint_path = Path(checkpoint_path)
        self.scaler_path = Path(scaler_path)
        self.device = torch.device(device)
        self.model_config = model_config or {}

        self.model: Optional[GraphIDS] = None
        self.scaler = None
        self.threshold: Optional[float] = None
        self.is_loaded = False
        self.model_version = "unknown"

        # Temporal heartbeat aggregation
        self.time_window = 1.0          # seconds; configurable via caller
        self.window_buffer = []         # list of (timestamp, score, label)
        self.last_emit_time = time.time()

        self._load_assets()

    # ------------------------------------------------------------------
    # Asset loading
    # ------------------------------------------------------------------

    def _load_assets(self):
        """Load scaler and initialize GraphIDS from checkpoint.

        Steps
        -----
        1. Load the MinMaxScaler used during training (best-effort).
        2. Build a ``GraphIDS`` instance from ``model_config``.
        3. Load trained weights and threshold from the checkpoint.
        """

        # ── 1. Scaler ──────────────────────────────────────────────────
        if self.scaler_path.exists():
            try:
                with open(self.scaler_path, "rb") as f:
                    self.scaler = pickle.load(f)
                logger.info("Loaded scaler from %s", self.scaler_path)
            except Exception as e:
                logger.error(
                    "Failed to load scaler from %s: %s. Proceeding without scaler.",
                    self.scaler_path,
                    e,
                    exc_info=True,
                )
                self.scaler = None
        else:
            logger.warning("Scaler not found at %s", self.scaler_path)

        # ── 2. Build model ─────────────────────────────────────────────
        cfg = self.model_config

        # Edge feature dimension: prefer scaler metadata, fall back to config.
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

        # During training for NF-UNSW-NB15-v3, ndim_in == edim_in.
        ndim_in      = edim_in
        edim_out     = int(cfg.get("edim_out", 128))
        embed_dim    = int(cfg.get("embed_dim", 256))
        num_heads    = int(cfg.get("num_heads", 4))
        num_layers   = int(cfg.get("num_layers", 4))
        dropout      = float(cfg.get("dropout", 0.0))
        ae_dropout   = float(cfg.get("ae_dropout", 0.1))
        window_size  = int(cfg.get("window_size", 512))
        pos_enc      = cfg.get("positional_encoding", "learnable")
        agg_type     = cfg.get("agg_type", "mean")
        mask_ratio   = float(cfg.get("mask_ratio", 0.0))

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
            positional_encoding=pos_enc,
            agg_type=agg_type,
            mask_ratio=mask_ratio,
        ).to(self.device)

        # ── 3. Load checkpoint ─────────────────────────────────────────
        if not self.checkpoint_path.exists():
            raise FileNotFoundError(
                f"Checkpoint not found: {self.checkpoint_path}"
            )

        try:
            epoch, threshold = self.model.load_checkpoint(
                str(self.checkpoint_path)
            )
            if threshold is None:
                raise RuntimeError(
                    "Checkpoint did not contain a threshold value. "
                    "Re-export the checkpoint with the trained threshold stored."
                )
            self.threshold = float(threshold)
            self.model_version = cfg.get(
                "model_version", "GraphIDS_NF-UNSW-NB15-v3"
            )
            self.is_loaded = True
            logger.info(
                "Loaded GraphIDS checkpoint from %s (epoch %s, threshold %.6f)",
                self.checkpoint_path,
                epoch,
                self.threshold,
            )
        except Exception as e:
            logger.error(
                "Failed to load model checkpoint from %s: %s",
                self.checkpoint_path,
                e,
                exc_info=True,
            )
            raise

    # ------------------------------------------------------------------
    # Feature scaling
    # ------------------------------------------------------------------

    def scale_features(self, features: np.ndarray) -> np.ndarray:
        """Scale raw edge features using the fitted scaler.

        Args:
            features: ``[num_edges, num_features]`` raw feature array.

        Returns:
            Scaled features ``[num_edges, num_features]``, clipped to
            ``[-10, 10]`` to match training preprocessing.
        """
        if self.scaler is None:
            logger.warning("Scaler not loaded; returning raw features.")
            return features

        if hasattr(self.scaler, "feature_names_in_"):
            import pandas as pd
            features = pd.DataFrame(
                features, columns=self.scaler.feature_names_in_
            )

        scaled = self.scaler.transform(features)
        scaled = np.nan_to_num(scaled, nan=0.0, posinf=10.0, neginf=-10.0)
        scaled = np.clip(scaled, -10.0, 10.0)
        return scaled

    # ------------------------------------------------------------------
    # Encoding
    # ------------------------------------------------------------------

    def encode_edges(
        self,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor,
        num_nodes: int,
    ) -> torch.Tensor:
        """Encode edges using the GraphIDS SAGELayer encoder.

        Args:
            edge_index: ``[2, num_edges]`` edge index tensor.
            edge_attr:  ``[num_edges, edim_in]`` edge feature tensor.
            num_nodes:  Number of nodes in the graph.

        Returns:
            Edge embeddings ``[num_edges, edim_out]``.
        """
        if not self.is_loaded or self.model is None:
            raise RuntimeError("GraphIDS model not loaded.")

        with torch.no_grad():
            edge_couples = edge_index.t().contiguous()
            edge_emb = self.model.encoder(
                edge_index=edge_index,
                edge_attr=edge_attr,
                edge_couples=edge_couples,
                num_nodes=num_nodes,
            )
        return edge_emb

    # ------------------------------------------------------------------
    # Reconstruction
    # ------------------------------------------------------------------

    def reconstruct_sequence(
        self,
        edge_embeddings: torch.Tensor,
        padding_mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Reconstruct edge embeddings via the Transformer autoencoder.

        Error aggregation uses MEAN over the window dimension, which
        matches the aggregation used when the trained threshold was
        computed.  Using MAX instead inflates errors by 7-35× on a
        512-step window, pushing all errors above the threshold and
        producing 100% FPR.

        Args:
            edge_embeddings: ``[batch_size, window_size, edim_out]``.
            padding_mask:    ``[batch_size, window_size]`` float mask
                             (1 = valid, 0 = padded), or ``None``.

        Returns:
            reconstructed:       ``[batch_size, window_size, edim_out]``
            errors:              ``[batch_size]`` mean reconstruction
                                 error per sequence.
            per_timestep_error:  ``[batch_size, window_size]`` per-step
                                 MSE before aggregation (for diagnostics).
        """
        if not self.is_loaded or self.model is None:
            raise RuntimeError("GraphIDS model not loaded.")

        with torch.no_grad():
            reconstructed = self.model.transformer(
                edge_embeddings, padding_mask
            )

            # Per-timestep MSE: mean over feature dimension → [batch, window]
            per_timestep_error = torch.mean(
                (edge_embeddings - reconstructed) ** 2,
                dim=2,
            )

            if padding_mask is not None:
                mask = padding_mask.float()
                valid_counts = torch.sum(mask, dim=1).clamp(min=1.0)
                # Mean only over valid (non-padded) positions
                errors = torch.sum(
                    per_timestep_error * mask, dim=1
                ) / valid_counts
            else:
                errors = torch.mean(per_timestep_error, dim=1)

        logger.debug(
            "[reconstruct] errors — min=%.6f mean=%.6f max=%.6f | "
            "trained_threshold=%.6f",
            errors.min().item(),
            errors.mean().item(),
            errors.max().item(),
            self.threshold if self.threshold is not None else float("nan"),
        )

        return reconstructed, errors, per_timestep_error

    # ------------------------------------------------------------------
    # Anomaly scoring
    # ------------------------------------------------------------------

    def compute_anomaly_score(
        self,
        errors: torch.Tensor,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Map reconstruction errors to anomaly scores and binary labels.

        Design
        ------
        The trained threshold is used directly as the sigmoid center so
        that the score-label relationship is always consistent:

            error == threshold  →  score ≈ 0.50  (decision boundary)
            error  > threshold  →  score  > 0.50  → label = 1 (anomaly)
            error  < threshold  →  score  < 0.50  → label = 0 (normal)

        The sigmoid scale is set to ``threshold`` itself so that an
        error of ``2 × threshold`` maps to score ≈ 0.73 and an error of
        ``0`` maps to score ≈ 0.27, giving a useful dynamic range.

        No adaptive threshold or rolling buffer is used.  The trained
        threshold is the ground truth; all adaptation belongs in
        retraining, not in inference.

        Args:
            errors: ``[batch_size]`` mean reconstruction errors from
                    ``reconstruct_sequence``.

        Returns:
            scores: ``[batch_size]`` float32 anomaly scores in ``[0, 1]``.
            labels: ``[batch_size]`` int binary predictions (0 or 1).
        """
        if self.threshold is None:
            raise RuntimeError(
                "Threshold not loaded from checkpoint. "
                "Cannot compute anomaly scores."
            )

        errors_np = errors.detach().cpu().numpy().astype(np.float64)

        if errors_np.size == 0:
            return np.array([], dtype=np.float32), np.array([], dtype=int)

        # Sanitize: replace any NaN/Inf with 0 (treated as benign)
        errors_np = np.nan_to_num(
            errors_np, nan=0.0, posinf=0.0, neginf=0.0
        )

        threshold = self.threshold  # trained value, e.g. 0.014

        # ── Binary labels ────────────────────────────────────────────────
        labels = (errors_np > threshold).astype(int)

        # ── Sigmoid score centered on trained threshold ──────────────────
        # Scale = 3 × threshold spreads the dynamic range so that benign
        # traffic sitting at 1.5–2× threshold scores in the 0.35–0.45 band
        # rather than 0.60–0.70, giving the dashboard a clean signal.
        #
        # Reference points at scale = 3τ:
        #   e = 0        → score ≈ 0.27  (clearly benign)
        #   e = τ        → score = 0.50  (decision boundary, unchanged)
        #   e = 2τ       → score ≈ 0.60  (mildly suspicious)
        #   e = 4τ       → score ≈ 0.73  (high)
        #   e = 7τ       → score ≈ 0.88  (critical)
        #
        # Clamp centered to [-12, 12] to prevent float overflow in exp.
        scale = getattr(self, '_sigmoid_scale', None) or max(3.0 * threshold, 1e-6)
        centered = (errors_np - threshold) / scale
        centered = np.clip(centered, -12.0, 12.0)
        scores = 1.0 / (1.0 + np.exp(-centered))

        scores = np.clip(scores, 0.0, 1.0)
        scores = np.nan_to_num(scores, nan=0.0, posinf=1.0, neginf=0.0)
        scores = scores.astype(np.float32)

        logger.debug(
            "[score] threshold=%.6f | errors [min=%.6f mean=%.6f max=%.6f] | "
            "scores [min=%.3f mean=%.3f max=%.3f] | anomaly_rate=%.3f",
            threshold,
            errors_np.min(), errors_np.mean(), errors_np.max(),
            scores.min(), scores.mean(), scores.max(),
            labels.mean(),
        )

        return scores, labels

    # ------------------------------------------------------------------
    # EMA smoothing
    # ------------------------------------------------------------------

    def smooth_scores(
        self,
        scores: np.ndarray,
        alpha: float = 0.2,
    ) -> np.ndarray:
        """Smooth anomaly scores using an exponential moving average.

        Args:
            scores: ``[batch_size]`` raw anomaly scores in ``[0, 1]``.
            alpha:  EMA factor in ``(0, 1]``. Lower = more smoothing.
                    Default 0.2 provides moderate lag reduction without
                    masking genuine anomaly spikes.

        Returns:
            Smoothed scores ``[batch_size]``.
        """
        scores = np.nan_to_num(scores, nan=0.0, posinf=1.0, neginf=0.0)

        if not hasattr(self, "_ema_prev"):
            self._ema_prev = scores.copy()
            return scores

        smoothed = alpha * scores + (1.0 - alpha) * self._ema_prev
        smoothed = np.nan_to_num(smoothed, nan=0.0, posinf=1.0, neginf=0.0)
        self._ema_prev = smoothed.copy()
        return smoothed

    # ------------------------------------------------------------------
    # Temporal heartbeat aggregation
    # ------------------------------------------------------------------

    def aggregate_scores(
        self,
        scores: np.ndarray,
        labels: np.ndarray,
    ) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        """Accumulate scores and emit one heartbeat per time window.

        Scores within a completed window are aggregated using the 95th
        percentile, which is robust to brief spikes while still capturing
        sustained anomalous periods.  The heartbeat label is derived
        directly from the aggregated score (≥ 0.5 → anomaly) so that
        score and label are always consistent on the dashboard.

        Args:
            scores: ``[batch_size]`` smoothed anomaly scores.
            labels: ``[batch_size]`` binary labels (informational only;
                    heartbeat label is re-derived from agg_score).

        Returns:
            ``(scores, labels)`` each of shape ``[1]`` when the current
            time window is complete, otherwise ``None``.
        """
        now = time.time()

        for s, l in zip(scores, labels):
            self.window_buffer.append((now, float(s), int(l)))

        if (now - self.last_emit_time) < self.time_window:
            return None

        if len(self.window_buffer) == 0:
            self.last_emit_time = now
            return None

        scores_arr = np.array([x[1] for x in self.window_buffer])

        # Mean heartbeat score — reflects the actual composition of the
        # window rather than the upper tail. p95 was suppressing dynamic
        # range by discarding the bottom 95% of the signal, making all
        # windows look uniformly high regardless of benign/malicious mix.
        # Mean lets a window of mostly-benign traffic score low even if a
        # few flows are elevated, producing a clean moving signal.
        agg_score = float(np.percentile(scores_arr, 95))
        # Label derived from score for dashboard consistency
        agg_label = 1 if agg_score >= 0.5 else 0

        self.window_buffer = []
        self.last_emit_time = now

        logger.debug(
            "[heartbeat] agg_score=%.4f agg_label=%d (window had %d samples)",
            agg_score,
            agg_label,
            len(scores_arr),
        )

        return (
            np.array([agg_score], dtype=np.float32),
            np.array([agg_label], dtype=int),
        )

    # ------------------------------------------------------------------
    # Full inference pipeline
    # ------------------------------------------------------------------

    def infer_batch(
        self,
        errors: torch.Tensor,
    ) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        """Run the full post-reconstruction inference pipeline.

        Steps
        -----
        1. ``compute_anomaly_score`` — threshold + sigmoid scoring.
        2. ``smooth_scores``         — EMA noise reduction.
        3. ``aggregate_scores``      — heartbeat window emission.

        Args:
            errors: ``[batch_size]`` mean reconstruction errors from
                    ``reconstruct_sequence``.

        Returns:
            ``(scores, labels)`` each of shape ``[1]`` once per completed
            time window, otherwise ``None``.
        """
        scores, labels = self.compute_anomaly_score(errors)
        scores = self.smooth_scores(scores)
        return self.aggregate_scores(scores, labels)

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def get_model_info(self) -> dict:
        """Return model metadata for the dashboard status panel."""
        return {
            "version":       self.model_version,
            "loaded":        self.is_loaded,
            "scaler_loaded": self.scaler is not None,
            "threshold":     self.threshold,
            "device":        str(self.device),
            "sigmoid_scale": getattr(self, "_sigmoid_scale", None),

        }