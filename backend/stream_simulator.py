#!/usr/bin/env python3
"""Simulate continuous NetFlow stream into the GraphIDS API.

Generates synthetic flows and periodically sends them to the
`/classify` endpoint so the dashboard can display activity.
"""

import random
import time
from typing import List

import requests

API_URL = "http://127.0.0.1:8000/classify"

# Example IPs and ports to simulate internal/external traffic
IPS: List[str] = [
    *(f"192.168.1.{i}" for i in range(1, 11)),
    *(f"10.0.0.{i}" for i in range(1, 11)),
]

PORTS: List[int] = list(range(1024, 65536, 256))


def generate_flow() -> dict:
    """Generate a single synthetic NetFlow-like record."""
    now = time.time()
    src_ip = random.choice(IPS)
    dst_ip = random.choice(IPS)
    # Avoid self-traffic occasionally
    if random.random() < 0.2:
        while dst_ip == src_ip:
            dst_ip = random.choice(IPS)

    return {
        "timestamp": now,
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "src_port": random.choice(PORTS),
        "dst_port": random.choice(PORTS),
        "protocol": random.choice([6, 17]),  # TCP, UDP
        "bytes": random.randint(100, 100_000),
        "packets": random.randint(1, 1_000),
        "duration_ms": random.randint(100, 10_000),
    }


def main() -> None:
    # Print a single startup line, then stay quiet except on errors
    print(f"Streaming synthetic flows to {API_URL} (press Ctrl+C to stop)...")
    session = requests.Session()

    while True:
        batch_size = random.randint(5, 20)
        flows = [generate_flow() for _ in range(batch_size)]

        try:
            resp = session.post(API_URL, json={"flows": flows}, timeout=10)
            if resp.status_code != 200:
                # Only print on errors to avoid spamming the terminal
                print(f"ERROR {resp.status_code}: {resp.text[:200]}")
        except Exception as exc:  # noqa: BLE001
            print(f"Request error: {exc}")

        # Short pause between batches
        time.sleep(1)


if __name__ == "__main__":
    main()
