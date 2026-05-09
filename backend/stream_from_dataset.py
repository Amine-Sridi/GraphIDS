"""Improved streaming of NetFlow data for realistic dashboard visualization.

"""

import argparse
import os
import time
from typing import List
from collections import deque

import numpy as np
import pandas as pd
import requests


# =========================
# CONFIG
# =========================
DATASET_NAME = "NF-UNSW-NB15-v3"
DATA_ROOT = os.path.join("..", "..", "data")
CSV_PATH = os.path.join(DATA_ROOT, DATASET_NAME, f"{DATASET_NAME}.csv")

API_URL = "http://localhost:8000/classify"
CONTROL_URL = "http://localhost:8000/stream-control"

BASE_STREAM_DELAY = 0.05  # smooth per-flow streaming (~20 flows/sec at 1x)
# Number of flows to send at maximum speed before switching to normal rate.
# Must be >= window_size (512) to guarantee the buffer fills before the
# first heartbeat is expected. 600 provides a margin for processing overhead.
WARMUP_FLOWS = 600
RETRY_COUNT = 3
CONTROL_POLL_INTERVAL = 0.5
BENIGN_LABEL = 0
MALICIOUS_LABEL = 1
MODEL_INFO_URL = "http://localhost:8000/model-info"
PHASE_POLL_INTERVAL = 2.0   # seconds between phase checks


# =========================
# SAFE FLOAT
# =========================
def safe_float(val, default=1e-6):
    """Avoid zero-collapse & NaN issues."""
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except Exception:
        return default


# =========================
# ROW → FLOW
# =========================
def row_to_flow(row: pd.Series, current_time: float) -> dict:
    """Convert a dataset row into a streaming flow dict."""
    in_bytes  = safe_float(row.get("IN_BYTES"))
    out_bytes = safe_float(row.get("OUT_BYTES"))
    in_pkts   = safe_float(row.get("IN_PKTS"))
    out_pkts  = safe_float(row.get("OUT_PKTS"))

    flow_dict = {
        "timestamp": current_time,
        "src_ip":    str(row["IPV4_SRC_ADDR"]),
        "dst_ip":    str(row["IPV4_DST_ADDR"]),
        "src_port":  int(row.get("L4_SRC_PORT", 0)),
        "dst_port":  int(row.get("L4_DST_PORT", 0)),
        "protocol":  int(row.get("PROTOCOL", 0)),
        "bytes":     int(in_bytes + out_bytes),
        "packets":   int(in_pkts + out_pkts),
        "duration_ms": safe_float(row.get("FLOW_DURATION_MILLISECONDS")),
        "bytes_in":    int(in_bytes),
        "bytes_out":   int(out_bytes),
        "packets_in":  int(in_pkts),
        "packets_out": int(out_pkts),
        "tcp_flags":   int(row.get("TCP_FLAGS", 0)),
        "all_features": {
            col: safe_float(row.get(col))
            for col in row.index
            if col not in ["IPV4_SRC_ADDR", "IPV4_DST_ADDR", "Label"]
        },
    }

    if "Label" in row:
        flow_dict["ground_truth_label"] = int(row["Label"])

    return flow_dict


def fetch_stream_control(session: requests.Session, fallback: dict) -> dict:
    """Fetch latest control state from backend; fall back on error."""
    try:
        response = session.get(CONTROL_URL, timeout=2)
        if response.status_code == 200:
            data = response.json()
            return {
                "is_active":      bool(data.get("is_active", True)),
                "ingestion_rate": float(data.get("ingestion_rate", 1.0)),
            }
    except Exception:
        pass
    return fallback


def fetch_normalizer_phase(session: requests.Session) -> str:
    """
    Fetch current normalizer phase from backend.

    Returns one of: 'SKIP', 'LEARN', 'SCORE', or 'UNKNOWN' on error.
    If the backend no longer exposes a normalizer phase (current
    inference.py contract), fall back to 'SCORE' so the streamer does
    not get stuck in benign-only mode forever.
    """
    try:
        response = session.get(MODEL_INFO_URL, timeout=2)
        if response.status_code == 200:
            data = response.json()
            normalizer = data.get("normalizer")
            if isinstance(normalizer, dict) and normalizer.get("phase"):
                return str(normalizer.get("phase")).upper()

            # New inference.py contract: no phase metadata is exposed.
            # In that case, phase-aware mode should not block mixed traffic.
            return "SCORE"
    except Exception:
        pass
    return "SCORE"


def should_stream_row(row: pd.Series, only_benign: bool, only_malicious: bool) -> bool:
    """Return True when the row matches the current streaming filter."""
    if not only_benign and not only_malicious:
        return True

    if "Label" not in row:
        return False

    try:
        label = int(row["Label"])
        if only_benign:
            return label == BENIGN_LABEL
        if only_malicious:
            return label == MALICIOUS_LABEL
    except Exception:
        pass
    return False


# =========================
# STREAMING LOOP
# =========================
def main():
    parser = argparse.ArgumentParser(
        description="Stream NetFlow dataset into the GraphIDS backend."
    )
    parser.add_argument(
        "--only-benign",
        action="store_true",
        default=False,
        help="Stream only benign rows (Label == 0).",
    )
    parser.add_argument(
        "--only-malicious",
        action="store_true",
        default=False,
        help="Stream only malicious rows (Label == 1).",
    )
    # --all-flows kept for explicitness but is now the implicit default
    parser.add_argument(
        "--all-flows",
        action="store_true",
        default=False,
        help="Stream both benign and malicious rows (default behaviour).",
    )
    parser.add_argument(
        "--phase-aware",
        action="store_true",
        default=False,
        help=(
            "Stream only benign flows during SKIP/LEARN phase, then switch to "
            "all flows automatically when the normalizer enters SCORE phase. "
            "Produces a cleaner baseline than streaming mixed traffic throughout."
        ),
    )
    parser.add_argument(
        "--no-warmup",
        action="store_true",
        default=False,
        help=(
            "Disable fast warmup mode. All flows will be sent at the normal "
            "BASE_STREAM_DELAY rate from the first flow. Use this if the backend "
            "buffer has already been pre-warmed at startup."
        ),
    )
    args = parser.parse_args()

    # Resolve mode — explicit flags win; default is all flows
    if args.only_benign and args.only_malicious:
        parser.error("--only-benign and --only-malicious are mutually exclusive.")

    only_benign    = args.only_benign
    only_malicious = args.only_malicious
    # --all-flows or no flag → both False → stream everything

    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"Dataset CSV not found at {CSV_PATH}")

    print(f"Streaming dataset from {CSV_PATH}...")
    if args.phase_aware:
        print("Filter: phase-aware (benign-only during SKIP/LEARN, all flows during SCORE).")
    elif only_benign:
        print("Filter: benign only (Label == 0).")
    elif only_malicious:
        print("Filter: malicious only (Label == 1).")
    else:
        print("Filter: all flows (benign + malicious).")

    session = requests.Session()
    total_sent    = 0
    total_skipped = 0

    current_time   = time.time()
    control_state  = {"is_active": True, "ingestion_rate": 1.0}
    next_control_poll = 0.0
    was_paused     = False

    # Phase-aware mode state
    phase_aware       = args.phase_aware
    current_phase     = "UNKNOWN"    # will be updated by polling
    next_phase_poll   = 0.0
    phase_switched    = False        # True once SCORE is reached and logged

    # Tracking for phase-aware debugging
    learn_phase_benign_sent = 0
    learn_phase_malicious_skipped = 0
    score_phase_benign_sent = 0
    score_phase_malicious_sent = 0

    # Fast warmup state
    fast_warmup_enabled = not args.no_warmup
    warmup_complete     = False   # True once WARMUP_FLOWS flows have been sent
    warmup_announced    = False   # True once the warmup-complete message is printed

    try:
        for chunk_df in pd.read_csv(CSV_PATH, chunksize=2000):
            chunk_df = chunk_df.sort_values("FLOW_START_MILLISECONDS")

            for _, row in chunk_df.iterrows():
                    now = time.time()
                    if now >= next_control_poll:
                        control_state = fetch_stream_control(session, control_state)
                        next_control_poll = now + CONTROL_POLL_INTERVAL

                    # Poll normalizer phase for phase-aware streaming
                    if phase_aware and now >= next_phase_poll:
                        current_phase   = fetch_normalizer_phase(session)
                        next_phase_poll = now + PHASE_POLL_INTERVAL

                    if not phase_switched and current_phase == "SCORE":
                        phase_switched = True
                        print(
                            "\n✓ Normalizer entered SCORE phase — switching to "
                            "mixed traffic (benign + malicious).\n"
                        )
                        # Log LEARN phase statistics
                        if phase_aware and (learn_phase_benign_sent > 0 or learn_phase_malicious_skipped > 0):
                            print(
                                f"  LEARN phase summary: {learn_phase_benign_sent} benign flows sent, "
                                f"{learn_phase_malicious_skipped} malicious flows skipped (CLEAN BASELINE)\n"
                            )
                    elif current_phase in ("SKIP", "LEARN") and not phase_switched:
                        # Still in warmup — log periodically so operator can see progress
                        pass  # polling handles this silently; progress is shown below

                    if not control_state["is_active"]:
                        if not was_paused:
                            print("Streaming paused by dashboard control.")
                            was_paused = True
                        time.sleep(0.2)
                        continue
                    elif was_paused:
                        print("Streaming resumed by dashboard control.")
                        was_paused = False

                    # Determine effective filter for this row
                    if phase_aware:
                        # Benign-only during SKIP/LEARN, all flows during SCORE
                        effective_only_benign    = current_phase in ("SKIP", "LEARN", "UNKNOWN")
                        effective_only_malicious = False
                    else:
                        effective_only_benign    = only_benign
                        effective_only_malicious = only_malicious

                    if not should_stream_row(row, effective_only_benign, effective_only_malicious):
                        total_skipped += 1
                        # Track what's being filtered during LEARN phase
                        if phase_aware and current_phase in ("SKIP", "LEARN", "UNKNOWN"):
                            if "Label" in row and int(row["Label"]) == 1:
                                learn_phase_malicious_skipped += 1
                        continue

                    # Track what's being sent during each phase
                    if phase_aware:
                        if current_phase in ("SKIP", "LEARN", "UNKNOWN"):
                            learn_phase_benign_sent += 1
                        else:
                            if "Label" in row:
                                if int(row["Label"]) == 0:
                                    score_phase_benign_sent += 1
                                else:
                                    score_phase_malicious_sent += 1

                    flow = row_to_flow(row, current_time)

                    success = False
                    for _ in range(RETRY_COUNT):
                        try:
                            resp = session.post(
                                API_URL,
                                json={"flows": [flow]},
                                timeout=5,
                            )
                            if resp.status_code == 200:
                                success = True
                                break
                        except Exception:
                            time.sleep(0.2)

                    if not success:
                        print("Failed to send flow.")

                    total_sent += 1
                    if total_sent % 100 == 0:
                        # Build status tags for the progress line
                        tags = []

                        # Show warmup status only if still in warmup AND in SKIP/LEARN phase
                        if fast_warmup_enabled and not warmup_complete and current_phase in ("SKIP", "LEARN", "UNKNOWN"):
                            tags.append(f"WARMUP {total_sent}/{WARMUP_FLOWS}")

                        # Phase-aware tag (only if --phase-aware is active)
                        if phase_aware:
                            if current_phase in ("SKIP", "LEARN", "UNKNOWN"):
                                tags.append(f"{current_phase}→BENIGN ONLY")
                            else:
                                tags.append("SCORE→ALL FLOWS")

                        tag_str = f" [{' | '.join(tags)}]" if tags else ""
                        print(f"✓ Sent {total_sent} flows{tag_str}")

                    if total_skipped > 0 and total_skipped % 100 == 0:
                        print(f"↷ Skipped {total_skipped} filtered flows")

                    ingestion_rate  = max(0.25, float(control_state.get("ingestion_rate", 1.0)))
                    effective_delay = BASE_STREAM_DELAY / ingestion_rate

                    # Fast warmup: only apply during SKIP/LEARN phases to ensure
                    # the normalizer builds a clean baseline from benign-only traffic.
                    # Once SCORE phase is reached, immediately disable warmup and
                    # switch to normal rate so mixed traffic (benign+malicious) arrives
                    # at measured pace, not as a flood.
                    if phase_aware and current_phase == "SCORE" and fast_warmup_enabled and not warmup_complete:
                        # SCORE phase reached — disable warmup immediately
                        warmup_complete = True
                        warmup_announced = True
                        print(
                            f"✓ Warmup disabled at SCORE phase transition. "
                            f"Switching to normal rate ({1.0 / effective_delay:.0f} flows/sec)."
                        )
                    elif fast_warmup_enabled and not warmup_complete and current_phase not in ("SKIP", "LEARN", "UNKNOWN"):
                        # Non-phase-aware mode: warmup only for first WARMUP_FLOWS
                        if total_sent >= WARMUP_FLOWS:
                            warmup_complete = True

                    if warmup_complete and not warmup_announced and not phase_aware:
                        warmup_announced = True
                        print(
                            f"✓ Warmup complete ({WARMUP_FLOWS} flows sent at full speed). "
                            f"Switching to normal rate ({1.0 / effective_delay:.0f} flows/sec)."
                        )

                    # Advance the monotonic flow timestamp regardless of sleep
                    current_time += effective_delay

                    # Apply no-delay warmup ONLY during SKIP/LEARN phases.
                    # Once SCORE phase begins, use normal rate immediately.
                    should_skip_delay = False
                    if fast_warmup_enabled and not warmup_complete:
                        if phase_aware:
                            # Phase-aware: skip delay only during SKIP/LEARN
                            should_skip_delay = current_phase in ("SKIP", "LEARN", "UNKNOWN")
                        else:
                            # Non-phase-aware: skip delay for first WARMUP_FLOWS
                            should_skip_delay = total_sent < WARMUP_FLOWS

                    if should_skip_delay:
                        time.sleep(0.001)  # minimal sleep to avoid CPU spin
                    else:
                        time.sleep(effective_delay)

    except KeyboardInterrupt:
        if phase_aware and warmup_complete:
            warmup_note = f" (warmup ended at SCORE phase transition)"
        elif fast_warmup_enabled and warmup_complete:
            warmup_note = f" (warmup completed at {WARMUP_FLOWS} flows)"
        elif fast_warmup_enabled:
            warmup_note = f" (stopped during warmup at {total_sent}/{WARMUP_FLOWS} flows)"
        else:
            warmup_note = ""
        
        phase_info = f" | Final phase: {current_phase}" if phase_aware else ""
        
        # Show phase-aware statistics if available
        phase_stats = ""
        if phase_aware and (learn_phase_benign_sent > 0 or score_phase_benign_sent > 0):
            phase_stats = (
                f"\n  LEARN: {learn_phase_benign_sent} benign (skipped {learn_phase_malicious_skipped} malicious)\n"
                f"  SCORE: {score_phase_benign_sent} benign + {score_phase_malicious_sent} malicious"
            )
        
        print(
            f"\nStopped. Sent {total_sent} flows, "
            f"skipped {total_skipped} filtered flows{warmup_note}{phase_info}.{phase_stats}"
        )


if __name__ == "__main__":
    main()