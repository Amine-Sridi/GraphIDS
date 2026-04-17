#!/usr/bin/env python3
"""Stream real NetFlow rows from the NF-UNSW-NB15-v3 dataset into the GraphIDS API.

Reads the CSV used for training and converts each row into the dashboard
NetFlowRecord format, then sends them in batches to `/classify` so you
can see *real* traffic patterns in the dashboard.

Run this from the `dashboard/backend` folder while `serve.py` and the
frontend are running.
"""

import os
import time
import random
from typing import List

import pandas as pd
import requests

# Adjust if you want to use another dataset
DATASET_NAME = "NF-UNSW-NB15-v3"
# Path is relative to the repo root (backend is 2 levels deep from root)
DATA_ROOT = os.path.join("..", "..", "data")
CSV_PATH = os.path.join(DATA_ROOT, DATASET_NAME, f"{DATASET_NAME}.csv")

API_URL = "http://127.0.0.1:8000/classify"
# Smaller batches and a longer pause make the live
# visualization less crowded and the time axis readable.
BATCH_SIZE = 16
SLEEP_SECONDS = 1.5  # Pause between batches (seconds)


def row_to_flow(row: pd.Series) -> dict:
    """Convert one NF-UNSW-NB15-v3 row to the NetFlowRecord JSON schema.

    This maps the core fields the backend expects. We also populate the
    optional bytes_in/out and packets_in/out fields so the real-time
    preprocessor can better align with the training feature layout.
    """

    # NF-UNSW-NB15-v3 uses these column names for IPs/ports and protocol.
    # If you customize your CSV, update this mapping accordingly.
    in_bytes = float(row.get("IN_BYTES", 0.0))
    out_bytes = float(row.get("OUT_BYTES", 0.0))
    in_pkts = float(row.get("IN_PKTS", 0.0))
    out_pkts = float(row.get("OUT_PKTS", 0.0))

    return {
        # Use the original FLOW_START_MILLISECONDS from the dataset so
        # that the features seen by the model (derived from timestamp)
        # exactly match the distribution it was trained on.
        "timestamp": float(row.get("FLOW_START_MILLISECONDS", 0.0)) / 1000.0,
        "src_ip": str(row["IPV4_SRC_ADDR"]),
        "dst_ip": str(row["IPV4_DST_ADDR"]),
        "src_port": int(row.get("L4_SRC_PORT", 0)),
        "dst_port": int(row.get("L4_DST_PORT", 0)),
        "protocol": int(row.get("PROTOCOL", 0)),
        "bytes": int(in_bytes + out_bytes),
        "packets": int(in_pkts + out_pkts),
        "duration_ms": float(row.get("FLOW_DURATION_MILLISECONDS", 0.0)),
        # Optional extras now populated to better match training features
        "bytes_in": int(in_bytes),
        "bytes_out": int(out_bytes),
        "packets_in": int(in_pkts),
        "packets_out": int(out_pkts),
        "tcp_flags": int(row.get("TCP_FLAGS", 0)) if "TCP_FLAGS" in row else None,
    }


def main() -> None:
    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"Dataset CSV not found at {CSV_PATH}")

    print(f"Streaming real flows from {CSV_PATH}...")
    # Use chunksize to avoid loading entire CSV into memory at once
    # This allows streaming large files without memory errors
    chunk_size = 5000  # Read 5000 rows at a time
    
    session = requests.Session()
    total_sent = 0
    chunk_number = 0

    print(f"Streaming real dataset flows to {API_URL} (Ctrl+C to stop)...")

    try:
        # Read CSV in chunks to handle large files
        for chunk_df in pd.read_csv(CSV_PATH, chunksize=chunk_size):
            chunk_number += 1
            print(f"Processing chunk {chunk_number} ({len(chunk_df)} rows)...")
            
            # Shuffle this chunk so the stream looks more realistic
            chunk_df = chunk_df.sample(frac=1.0, random_state=42).reset_index(drop=True)
            
            # Stream this chunk in batches
            for idx in range(0, len(chunk_df), BATCH_SIZE):
                batch_rows = chunk_df.iloc[idx : min(idx + BATCH_SIZE, len(chunk_df))]
                
                flows: List[dict] = [row_to_flow(row) for _, row in batch_rows.iterrows()]
                
                try:
                    resp = session.post(API_URL, json={"flows": flows}, timeout=15)
                    if resp.status_code != 200:
                        print(f"ERROR {resp.status_code}: {resp.text[:200]}")
                    else:
                        total_sent += len(flows)
                        print(f"✓ Sent batch of {len(flows)} flows (total: {total_sent})")
                except Exception as exc:  # noqa: BLE001
                    print(f"Request error: {exc}")
                
                time.sleep(SLEEP_SECONDS)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        raise


if __name__ == "__main__":
    main()
