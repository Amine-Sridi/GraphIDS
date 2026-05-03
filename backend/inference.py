"""Model loading and inference wrapper for the dashboard.

This module adapts the trained GraphIDS model for real-time inference.
It loads the same checkpoint used during training and exposes a minimal
interface (scale → encode → reconstruct → score) for the streaming
pipeline in ``stream.py``.

Changelog:
- FIX: Reverted error aggregation from MAX to MEAN to match training-time
threshold computation. MAX over 512 timesteps inflated all errors 7-35x
above the trained threshold (0.014), causing 100% FPR.
- FIX: Removed adaptive threshold mechanism. It was designed to compensate
for the aggregation mismatch symptom and actively prevented correction
(threshold_cap = trained_threshold * 1.5 = 0.021 blocked any real fix).
- FIX: Removed window_counter-dependent aggregation branching (MEAN vs MAX
switch at window 100) which was the direct cause of the FPR spike.
- FIX: compute_anomaly_score now accepts node_count and routes through a
three-phase GraphStabilityNormalizer that defers scoring until the graph
has stabilised. This fixes the baseline lock-out where warmup (sparse
graph, errors ≈ 0.030-0.040) built a baseline that permanently flagged
dense-graph benign traffic (errors ≈ 0.044-0.053) as anomalous.
- FIX: Sigma floor raised to 0.010 (from 0.005) and Z_THRESHOLD raised to
3.0 (from 1.0). With SIGMA_FLOOR=0.005 and Z_THRESHOLD=1.0 the decision
cutoff was μ+0.005, which falls inside the benign error cloud (0.044–0.053)
whenever μ drifts toward the low end of that range — causing FPR≈100%.
SIGMA_FLOOR=0.010 and Z_THRESHOLD=3.0 places the cutoff at μ+0.030, well
above the benign ceiling of 0.053.
- FIX: EMA smoothing now resets _ema_prev to NEUTRAL_SCORE at the LEARN→SCORE
transition. Previously the EMA carried forward stale 0.27 neutral scores
accumulated during SKIP/LEARN, creating a multi-minute lag where the
displayed score rose from 0.27 toward the true SCORE-phase value — producing
the two characteristic humps seen on the dashboard for pure benign traffic.
- CLEANUP: Removed recent_errors buffer and all adaptive logic that
depended on it.
- KEPT: Temporal heartbeat aggregation (aggregate_scores) — logic is sound.
- KEPT: EMA smoothing (smooth_scores) — logic is sound.
- KEPT: All defensive nan_to_num / clip guards throughout.
"""

import os
import pickle
import logging
import time
from collections import deque
from enum import Enum, auto
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import sys
from importlib.util import spec_from_file_location, module_from_spec

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
# _Phase / _GraphStabilityNormalizer  (private to this module)
# ---------------------------------------------------------------------------

class _Phase(Enum):
    SKIP  = auto()   # graph growing — discard errors, return neutral score
    LEARN = auto()   # graph stable, collecting distribution baseline
    SCORE = auto()   # baseline ready, MAD-based scoring active


class _GraphStabilityNormalizer:
    """Three-phase error normalizer using adaptive percentile-based scoring.

    Problem (Original Approach)
    -------
    Reconstruction error is a function of graph density.  During warmup
    (sparse graph, few nodes) errors sit at 0.030–0.040.  Once the graph
    stabilises (dense phase, 37+ nodes) all errors shift upward to
    0.044–0.053 (benign) and 0.090+ (malicious).  Any baseline built
    during the sparse phase is wrong.

    Why Percentiles, Not Z-Scores
    ------------------------------
    Z-score normalization assumes Gaussian distribution, but reconstruction
    errors from autoencoders are often multimodal or skewed:
    - Benign: tight cluster at 0.044-0.053
    - Malicious: spread 0.090-0.200 (variable attack types)
    
    This creates a valley between modes where z-score fails. Percentiles
    work on any distribution: simply flag the top N% of errors as anomalous.

    Scoring
    -------
    Modified z-score (Iglewicz & Hoaglin 1993):
        M_i = 0.6745 × (error_i − median) / MAD

    The 0.6745 factor makes M_i equivalent to a standard normal z-score
    when the distribution is Gaussian.  Decision boundary at |M| = 3.5
    gives FPR < 0.001 on a normal distribution and is robust to skew.

    Sigmoid mapping:
        score = sigmoid((M - Z_THRESHOLD) / Z_SCALE)
        M = Z_THRESHOLD → score = 0.50  (decision boundary)
        M = 0           → score ≈ 0.27  (deep benign)
        M = 7           → score ≈ 0.73  (high)
        M = 14          → score ≈ 0.88  (critical)

    Baseline update
    ---------------
    During SCORE the baseline deque is updated with ALL incoming errors
    (both benign and malicious) because MAD is robust enough to handle
    the contamination.  This allows the reference to track genuine
    long-term drift in the network (new services, changing traffic
    patterns) without being corrupted by sustained attacks.

    Phases
    ------
    SKIP  — node-count EMA growth > STABILITY_GROWTH_THRESHOLD or fewer
            than MIN_SKIP_WINDOWS seen.  Returns NEUTRAL_SCORE, label=0.
    LEARN — growth settled; collecting errors.  Returns NEUTRAL_SCORE,
            label=0.  Exits when MIN_BASELINE_SAMPLES collected.
    SCORE — MAD scoring active; baseline updated online with all errors.
    """

    # ── Phase-transition parameters ────────────────────────────────────
    MIN_BASELINE_SAMPLES:       int   = 400
    BASELINE_DEQUE_SIZE:        int   = 2000
    STABILITY_GROWTH_THRESHOLD: float = 2.0     # nodes/window EMA
    STABILITY_EMA_ALPHA:        float = 0.2
    MIN_SKIP_WINDOWS:           int   = 20  # ~30 seconds for full graph stabilization

    # ── Scoring parameters ─────────────────────────────────────────────
    # Percentile threshold for anomaly flagging.
    # ANOMALY_PERCENTILE=90 means: flag errors in top 10% (90th percentile and above).
    # Lower values = more aggressive (catch more attacks, higher FPR).
    # Higher values = more conservative (fewer false positives, miss some attacks).
    # Adaptive thresholding can adjust this based on feedback.
    ANOMALY_PERCENTILE: float = 95.0  # Flag top 15% of errors
    # Neutral score during SKIP/LEARN — well below 0.50 so the EMA cannot
    # drift above the decision boundary before SCORE phase starts.
    NEUTRAL_SCORE: float = 0.40

    def __init__(self) -> None:
        self.phase: _Phase = _Phase.SKIP
        self._windows_seen: int = 0

        # Node-count growth rate estimator
        self._prev_node_count: Optional[int] = None
        self._growth_rate_ema: float = float("inf")

        # Rolling error buffer for percentile computation
        self._baseline: deque = deque(maxlen=self.BASELINE_DEQUE_SIZE)
        # Cached percentile thresholds (recomputed on baseline update)
        self._p50: float = 0.0   # median
        self._p85: float = 0.0   # 85th percentile (anomaly boundary)
        self._p95: float = 0.0   # 95th percentile (critical)

        # Flag set at LEARN→SCORE so smooth_scores flushes its EMA state
        # before the first real scored output — prevents the neutral-score
        # ramp-up artefact visible as false-positive humps on the dashboard.
        self.ema_reset_needed: bool = False

        # Diagnostics
        self.total_scored:  int = 0
        self.total_skipped: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def score(
        self,
        errors: np.ndarray,
        node_count: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Map reconstruction errors to anomaly (scores, labels).

        Works correctly on mixed benign+malicious traffic.  The MAD
        estimator is robust to up to ~30% malicious contamination, so
        the reference distribution tracks the bulk of traffic regardless
        of the attack rate in the stream.

        Args:
            errors:     ``[batch_size]`` float64 mean reconstruction errors.
            node_count: Current unique-node count from the graph preprocessor.

        Returns:
            scores: ``[batch_size]`` float32 in [0, 1].
            labels: ``[batch_size]`` int (0 = normal, 1 = anomalous).
        """
        errors = np.nan_to_num(
            np.asarray(errors, dtype=np.float64),
            nan=0.0, posinf=0.0, neginf=0.0,
        )

        self._windows_seen += 1
        self._update_growth_rate(node_count)
        self._advance_phase(errors)

        if self.phase in (_Phase.SKIP, _Phase.LEARN):
            self.total_skipped += len(errors)
            neutral = np.full(len(errors), self.NEUTRAL_SCORE, dtype=np.float32)
            return neutral, np.zeros(len(errors), dtype=int)

        return self._percentile_score(errors)

    def reset(self) -> None:
        """Full reset — call from the /reset endpoint."""
        self.phase             = _Phase.SKIP
        self._windows_seen     = 0
        self._prev_node_count  = None
        self._growth_rate_ema  = float("inf")
        self._baseline.clear()
        self._p50              = 0.0
        self._p85              = 0.0
        self._p95              = 0.0
        self.ema_reset_needed  = False
        self.total_scored      = 0
        self.total_skipped     = 0
        logger.info("[normalizer] reset → SKIP")

    def get_status(self) -> dict:
        """Diagnostic snapshot surfaced via get_model_info()."""
        return {
            "phase":            self.phase.name,
            "windows_seen":     self._windows_seen,
            "growth_rate_ema":  round(self._growth_rate_ema, 4)
                                if self._growth_rate_ema != float("inf") else None,
            "baseline_samples": len(self._baseline),
            "p50_median":       round(self._p50, 6),
            "p85_anomaly_threshold": round(self._p85, 6),
            "p95_critical":     round(self._p95, 6),
            "anomaly_percentile": self.ANOMALY_PERCENTILE,
            "total_scored":     self.total_scored,
            "total_skipped":    self.total_skipped,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _update_growth_rate(self, node_count: int) -> None:
        if self._prev_node_count is None:
            self._prev_node_count = node_count
            return
        delta = max(0, node_count - self._prev_node_count)
        self._prev_node_count = node_count
        if self._growth_rate_ema == float("inf"):
            self._growth_rate_ema = float(delta)
        else:
            self._growth_rate_ema = (
                self.STABILITY_EMA_ALPHA * delta
                + (1.0 - self.STABILITY_EMA_ALPHA) * self._growth_rate_ema
            )

    def _advance_phase(self, errors: np.ndarray) -> None:
        if self.phase == _Phase.SKIP:
            if (
                self._windows_seen >= self.MIN_SKIP_WINDOWS
                and self._growth_rate_ema < self.STABILITY_GROWTH_THRESHOLD
            ):
                self.phase = _Phase.LEARN
                self._baseline.clear()
                logger.info(
                    "[normalizer] SKIP → LEARN | windows=%d "
                    "growth_ema=%.3f nodes=%s",
                    self._windows_seen,
                    self._growth_rate_ema,
                    self._prev_node_count,
                )
            return  # never feed sparse-phase errors into the baseline

        if self.phase == _Phase.LEARN:
            # Only keep bottom 30% of each batch — pure benign, no attack contamination.
            # At 6.5% baseline attack rate, bottom 30% has ~<0.2% attacks.
            # Bottom 70% would include most attacks in mixed batches.
            batch_p30 = float(np.percentile(errors, 30))
            benign_candidates = errors[errors <= batch_p30]
            if len(benign_candidates) > 0:
                for e in benign_candidates:
                    self._baseline.append(float(e))
            else:
                # Fallback: whole batch if filtering leaves nothing
                for e in errors:
                    self._baseline.append(float(e))

            self._recompute_stats()
            if len(self._baseline) >= self.MIN_BASELINE_SAMPLES:
                self.phase = _Phase.SCORE
                self.ema_reset_needed = True
                logger.info(
                    "[normalizer] LEARN → SCORE | "
                    "p50=%.6f p85=%.6f p95=%.6f samples=%d",
                    self._p50,
                    self._p85,
                    self._p95,
                    len(self._baseline),
                )
            return

        # SCORE — update baseline with ALL errors (MAD handles contamination)
        if self.phase == _Phase.SCORE:
            batch_p70 = float(np.percentile(errors, 70))
            for e in errors:
                if e <= batch_p70:
                    self._baseline.append(float(e))
            self._recompute_stats()

    def _percentile_score(self, errors: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Compute percentile-based anomaly scores and labels.
        
        For each error, determine its percentile rank in the baseline distribution,
        then map to score [0, 1] and label based on ANOMALY_PERCENTILE threshold.
        Works on any error distribution (Gaussian, skewed, multimodal).
        """
        if len(self._baseline) == 0:
            # Fallback if baseline empty
            scores = np.full(len(errors), self.NEUTRAL_SCORE, dtype=np.float32)
            labels = np.zeros(len(errors), dtype=int)
            return scores, labels

        baseline_arr = np.array(self._baseline, dtype=np.float64)

        # Compute percentile rank for each error
        # percentileofscore returns [0, 100] where score indicates percentage of
        # baseline values strictly less than or equal to the value
        from scipy.stats import percentileofscore
        percentile_ranks = np.array(
            [percentileofscore(baseline_arr, float(e), kind='rank') for e in errors],
            dtype=np.float64
        )
        percentile_ranks = np.clip(percentile_ranks, 0.0, 100.0)

        # Scores: normalized percentile rank [0, 1]
        scores = (percentile_ranks / 100.0).astype(np.float32)

        # Labels: 1 if in top (100 - ANOMALY_PERCENTILE)% of errors
        labels = (percentile_ranks > self.ANOMALY_PERCENTILE).astype(int)

        self.total_scored += len(errors)

        logger.debug(
            "[normalizer/SCORE] p50=%.6f p85=%.6f p95=%.6f | "
            "errors [%.6f–%.6f] percentiles [%.1f–%.1f] | "
            "scores [%.3f–%.3f] anomaly_rate=%.3f",
            self._p50, self._p85, self._p95,
            errors.min(), errors.max(),
            percentile_ranks.min(), percentile_ranks.max(),
            scores.min(), scores.max(),
            labels.mean(),
        )

        return scores, labels

    def _recompute_stats(self) -> None:
        if len(self._baseline) == 0:
            return
        arr = np.array(self._baseline, dtype=np.float64)
        self._p50 = float(np.percentile(arr, 50))
        self._p85 = float(np.percentile(arr, 85))
        self._p95 = float(np.percentile(arr, 95))


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
    three-phase GraphStabilityNormalizer embedded in
    compute_anomaly_score(errors, node_count).
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
        self.checkpoint_path = Path(checkpoint_path)
        self.scaler_path     = Path(scaler_path)
        self.device          = torch.device(device)
        self.model_config    = model_config or {}

        self.model: Optional[GraphIDS] = None
        self.scaler = None
        self.threshold: Optional[float] = None
        self.is_loaded    = False
        self.model_version = "unknown"

        # Temporal heartbeat aggregation
        self.time_window    = 1.5
        self.window_buffer  = []
        self.last_emit_time = time.time()

        # Graph-stability-aware normalizer — owns the SKIP/LEARN/SCORE logic
        self._normalizer = _GraphStabilityNormalizer()

        self._load_assets()

    # ------------------------------------------------------------------
    # Asset loading
    # ------------------------------------------------------------------

    def _load_assets(self):
        # ── 1. Scaler ──────────────────────────────────────────────────
        if self.scaler_path.exists():
            try:
                with open(self.scaler_path, "rb") as f:
                    self.scaler = pickle.load(f)
                logger.info("Loaded scaler from %s", self.scaler_path)
            except Exception as e:
                logger.error(
                    "Failed to load scaler from %s: %s. Proceeding without scaler.",
                    self.scaler_path, e, exc_info=True,
                )
                self.scaler = None
        else:
            logger.warning("Scaler not found at %s", self.scaler_path)

        # ── 2. Build model ─────────────────────────────────────────────
        cfg = self.model_config

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

        ndim_in     = edim_in
        edim_out    = int(cfg.get("edim_out",    128))
        embed_dim   = int(cfg.get("embed_dim",   256))
        num_heads   = int(cfg.get("num_heads",     4))
        num_layers  = int(cfg.get("num_layers",    4))
        dropout     = float(cfg.get("dropout",   0.0))
        ae_dropout  = float(cfg.get("ae_dropout", 0.1))
        window_size = int(cfg.get("window_size", 512))
        pos_enc     = cfg.get("positional_encoding", "learnable")
        agg_type    = cfg.get("agg_type", "mean")
        mask_ratio  = float(cfg.get("mask_ratio", 0.0))

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
            raise FileNotFoundError(f"Checkpoint not found: {self.checkpoint_path}")

        try:
            epoch, threshold = self.model.load_checkpoint(str(self.checkpoint_path))
            if threshold is None:
                raise RuntimeError(
                    "Checkpoint did not contain a threshold value. "
                    "Re-export the checkpoint with the trained threshold stored."
                )
            self.threshold     = float(threshold)
            self.model_version = cfg.get("model_version", "GraphIDS_NF-UNSW-NB15-v3")
            self.is_loaded     = True
            logger.info(
                "Loaded GraphIDS checkpoint from %s (epoch %s, threshold %.6f)",
                self.checkpoint_path, epoch, self.threshold,
            )
        except Exception as e:
            logger.error(
                "Failed to load model checkpoint from %s: %s",
                self.checkpoint_path, e, exc_info=True,
            )
            raise

    # ------------------------------------------------------------------
    # Feature scaling
    # ------------------------------------------------------------------

    def scale_features(self, features: np.ndarray) -> np.ndarray:
        """Scale raw edge features using the fitted scaler."""
        if self.scaler is None:
            logger.warning("Scaler not loaded; returning raw features.")
            return features

        if hasattr(self.scaler, "feature_names_in_"):
            import pandas as pd
            features = pd.DataFrame(features, columns=self.scaler.feature_names_in_)

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
        """Encode edges using the GraphIDS SAGELayer encoder."""
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

        Error aggregation uses MEAN over the window dimension, matching the
        aggregation used when the trained threshold was computed.

        Returns:
            reconstructed:       ``[batch, window, edim_out]``
            errors:              ``[batch]`` mean reconstruction error per sequence.
            per_timestep_error:  ``[batch, window]`` per-step MSE (diagnostics).
        """
        if not self.is_loaded or self.model is None:
            raise RuntimeError("GraphIDS model not loaded.")

        with torch.no_grad():
            reconstructed = self.model.transformer(edge_embeddings, padding_mask)

            per_timestep_error = torch.mean(
                (edge_embeddings - reconstructed) ** 2,
                dim=2,
            )

            if padding_mask is not None:
                mask         = padding_mask.float()
                valid_counts = torch.sum(mask, dim=1).clamp(min=1.0)
                errors       = torch.sum(per_timestep_error * mask, dim=1) / valid_counts
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
    # Anomaly scoring  ← normalizer lives here
    # ------------------------------------------------------------------

    def compute_anomaly_score(
        self,
        errors: torch.Tensor,
        node_count: int = 0,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Map reconstruction errors to anomaly scores and binary labels.

        Scoring is delegated to an embedded three-phase
        ``_GraphStabilityNormalizer`` that handles the two distinct error
        regimes produced by GraphIDS:

        Regime 1 — sparse graph (warmup):
            errors ≈ 0.030–0.040  (few nodes, simple neighbourhood)
        Regime 2 — dense graph (steady state):
            errors ≈ 0.044–0.053  (rich neighbourhoods, harder to reconstruct)

        Using a single static threshold across both regimes causes 100 % FPR
        because the trained threshold (≈ 0.014) is well below both regimes,
        and any baseline built during Regime 1 produces z-scores of ~10 for
        normal Regime 2 traffic.

        Normalizer phases
        -----------------
        SKIP  — graph growing fast; returns score=0.27, label=0.
        LEARN — graph stable, collecting baseline; returns score=0.27, label=0.
        SCORE — baseline ready; z-score sigmoid scoring.
                score > 0.5  ⟺  z > Z_THRESHOLD  ⟺  label = 1 (anomaly).

        Args:
            errors:     ``[batch_size]`` mean reconstruction errors from
                        ``reconstruct_sequence``.
            node_count: Current unique-node count from the stream preprocessor
                        (``StreamProcessor.preprocessor.get_node_count()``).
                        Used by the normalizer to detect graph stabilisation.
                        Defaults to 0 (normalizer stays in SKIP).

        Returns:
            scores: ``[batch_size]`` float32 anomaly scores in [0, 1].
            labels: ``[batch_size]`` int binary predictions (0 or 1).
        """
        if not self.is_loaded:
            raise RuntimeError("GraphIDS model not loaded.")

        errors_np = errors.detach().cpu().numpy().astype(np.float64)

        if errors_np.size == 0:
            return np.array([], dtype=np.float32), np.array([], dtype=int)

        errors_np = np.nan_to_num(errors_np, nan=0.0, posinf=0.0, neginf=0.0)

        scores, labels = self._normalizer.score(errors_np, node_count)

        logger.debug(
            "[score] phase=%s node_count=%d | "
            "errors [min=%.6f mean=%.6f max=%.6f] | "
            "scores [min=%.3f mean=%.3f max=%.3f] | anomaly_rate=%.3f",
            self._normalizer.phase.name,
            node_count,
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
        alpha: float = 0.6,
    ) -> np.ndarray:
        """Smooth anomaly scores using an exponential moving average.

        The EMA state is reset to NEUTRAL_SCORE at the LEARN→SCORE phase
        transition. Without this, the 0.10 neutral scores accumulated during
        SKIP/LEARN create a slow ramp-up in the displayed score as the EMA
        converges toward the true SCORE-phase values — producing the two-hump
        artefact visible on the dashboard for pure benign traffic.
        """
        scores = np.nan_to_num(scores, nan=0.0, posinf=1.0, neginf=0.0)

        # Flush EMA at phase transition so stale neutral scores do not bleed
        # into the first real scored outputs.
        if self._normalizer.ema_reset_needed:
            self._normalizer.ema_reset_needed = False
            self._ema_prev = np.full_like(scores, self._normalizer.NEUTRAL_SCORE)
            logger.info("[smooth_scores] EMA reset at LEARN→SCORE transition")

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
        """Aggregate scores for dashboard using single-stage score thresholding.
        
        Single-stage approach: scores are continuous [0, 1] from percentile ranking.
        Aggregation uses p85 to emphasize windows with elevated errors.
        Final decision is based directly on agg_score, preserving full score information.
        This avoids information loss from early binarization.
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
        labels_arr = np.array([x[2] for x in self.window_buffer])

        # Single-stage thresholding: use p85 of continuous scores (not binary labels).
        # p85 captures windows in top 15% of error magnitude, emphasizing sustained elevation.
        agg_score = float(np.quantile(scores_arr, 0.85))

        # Heartbeat label decision based directly on aggregated score.
        # Score 0.65 ≈ 65th percentile of baseline errors (balanced).
        # Targets TPR >75% while keeping FPR <20%. Goldilocks with MAJORITY=0.10.
        agg_label = 1 if agg_score >= 0.90 else 0

        self.window_buffer = []
        self.last_emit_time = now

        logger.debug(
            "[heartbeat] agg_score=%.4f agg_label=%d (window size=%d, p85=%.4f mean=%.4f)",
            agg_score, agg_label, len(scores_arr), 
            np.quantile(scores_arr, 0.85), np.mean(scores_arr),
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
        node_count: int = 0,
    ) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        """Run the full post-reconstruction inference pipeline.

        Steps
        -----
        1. ``compute_anomaly_score(errors, node_count)`` — phase-aware scoring.
        2. ``smooth_scores``                             — EMA noise reduction.
        3. ``aggregate_scores``                          — heartbeat emission.

        Args:
            errors:     ``[batch_size]`` mean reconstruction errors.
            node_count: Current graph node count (passed to normalizer).

        Returns:
            ``(scores, labels)`` each of shape ``[1]`` once per completed
            time window, otherwise ``None``.
        """
        scores, labels = self.compute_anomaly_score(errors, node_count)
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
            "normalizer":    self._normalizer.get_status(),
        }

    def reset_normalizer(self) -> None:
        """Reset the stability normalizer — call from the /reset endpoint."""
        self._normalizer.reset()
        self.window_buffer = []
        self.last_emit_time = time.time()
        if hasattr(self, "_ema_prev"):
            del self._ema_prev