# Testing & Usage Guide for GraphIDS Dashboard

This guide covers testing the dashboard locally and integrating it with real NetFlow data.

## 📌 Table of Contents

1. [Local Testing](#local-testing)
2. [API Testing](#api-testing)
3. [Integration with Real Data](#integration-with-real-data)
4. [Performance Testing](#performance-testing)
5. [Troubleshooting](#troubleshooting)

---

## 🧪 Local Testing

### 1. Start Backend

```bash
cd dashboard
python serve.py
```

You should see:
```
INFO: Uvicorn running on http://127.0.0.1:8000
INFO: ✓ Inference engine loaded
INFO: ✓ Stream processor initialized
```

### 2. Start Frontend (in another terminal)

```bash
cd dashboard/frontend
npm run dev
```

You should see:
```
  ➜  Local:   http://127.0.0.1:3000/
```

### 3. Open Dashboard

Navigate to `http://127.0.0.1:3000` in your browser.

You should see:
- Header with "GraphIDS" branding
- Health indicator (should show "System Operational")
- Empty dashboard (no flows processed yet)
- Tabs: Dashboard, Events, Statistics

---

## 🔧 API Testing

### Quick Test with Sample Data

```bash
# From dashboard/ directory
curl -X POST http://127.0.0.1:8000/classify \
  -H "Content-Type: application/json" \
  -d @sample_flows.json
```

Expected response:
```json
{
  "classifications": [
    {
      "flow_id": "abcd1234ef56",
      "timestamp": 1711491600.0,
      "src_ip": "192.168.1.10",
      "dst_ip": "8.8.8.8",
      "src_port": 54321,
      "dst_port": 443,
      "score": 0.15,
      "label": 0,
      "confidence": 0.7,
      "window_id": 0,
      "processing_time_ms": 45.2
    },
    ...
  ],
  "batch_id": "batch_1",
  "processed_count": 3,
  "error_count": 0,
  "total_time_ms": 156.8,
  "model_version": "unknown"
}
```

### Health Check

```bash
curl http://127.0.0.1:8000/health
```

Response:
```json
{
  "status": "healthy",
  "model_loaded": true,
  "scaler_loaded": true,
  "message": ""
}
```

### Get Recent Events

```bash
curl "http://127.0.0.1:8000/events?limit=10&min_score=0.0"
```

### Get Statistics

```bash
curl http://127.0.0.1:8000/stats
```

Response:
```json
{
  "total_flows_processed": 3,
  "total_anomalies_detected": 0,
  "anomaly_rate": 0.0,
  "avg_anomaly_score": 0.12,
  "current_window_id": 1,
  "model_version": "unknown",
  "uptime_seconds": 123.45,
  "node_count": 6,
  "buffer_size": 3
}
```

### Interactive API Documentation

Visit `http://127.0.0.1:8000/docs` (Swagger UI) to:
- Explore all endpoints
- Send test requests
- See response schemas
- Download OpenAPI spec

---

## 🌍 Integration with Real Data

### From NetFlow Collector

If you have a NetFlow collector (e.g., nfdump, pmacct), export flows and pipe to the API:

```bash
# Example: nfdump to JSON to API
nfdump -r flows.nf -o json | python forward_to_api.py
```

Example Python forwarder:

```python
#!/usr/bin/env python3
"""Forward NetFlow data to GraphIDS API"""

import json
import sys
import requests
from datetime import datetime

API_URL = "http://127.0.0.1:8000/classify"
BATCH_SIZE = 100

def netflow_to_flow(nf_record):
    """Convert nfdump JSON to API format"""
    return {
        "timestamp": datetime.fromisoformat(nf_record["start"]).timestamp(),
        "src_ip": nf_record["src_ip"],
        "dst_ip": nf_record["dst_ip"],
        "src_port": nf_record["src_port"],
        "dst_port": nf_record["dst_port"],
        "protocol": nf_record["protocol"],
        "bytes": nf_record.get("bytes", 0),
        "packets": nf_record.get("packets", 0),
        "duration_ms": nf_record.get("duration", 0),
    }

batch = []
for line in sys.stdin:
    record = json.loads(line)
    batch.append(netflow_to_flow(record))
    
    if len(batch) >= BATCH_SIZE:
        response = requests.post(API_URL, json={"flows": batch})
        print(f"Sent {len(batch)} flows: {response.status_code}")
        batch = []

if batch:
    response = requests.post(API_URL, json={"flows": batch})
    print(f"Sent {len(batch)} flows: {response.status_code}")
```

### From Syslog/Sflow

Parse incoming Sflow data and convert to NetFlow format before sending to API.

### Simulated Stream Test

Generate synthetic traffic to test the dashboard:

```python
#!/usr/bin/env python3
"""Simulate continuous NetFlow stream"""

import requests
import time
import random

API_URL = "http://127.0.0.1:8000/classify"

IPS = [
    "192.168.1." + str(i) for i in range(1, 11)
] + [
    "10.0.0." + str(i) for i in range(1, 11)
]

PORTS = list(range(1024, 65536, 256))

def generate_flow():
    return {
        "timestamp": time.time(),
        "src_ip": random.choice(IPS),
        "dst_ip": random.choice(IPS),
        "src_port": random.choice(PORTS),
        "dst_port": random.choice(PORTS),
        "protocol": random.choice([6, 17]),  # TCP, UDP
        "bytes": random.randint(100, 100000),
        "packets": random.randint(1, 1000),
        "duration_ms": random.randint(100, 10000),
    }

print("Streaming synthetic flows...")
while True:
    flows = [generate_flow() for _ in range(random.randint(5, 20))]
    response = requests.post(API_URL, json={"flows": flows})
    
    if response.status_code == 200:
        result = response.json()
        anomalies = sum(1 for c in result["classifications"] if c["label"] == 1)
        print(f"[{time.strftime('%H:%M:%S')}] Sent {len(flows)} flows, {anomalies} anomalies")
    else:
        print(f"ERROR: {response.status_code}")
    
    time.sleep(1)
```

Run it:
```bash
python stream_simulator.py
```

---

## 📊 Performance Testing

### Load Test

Use `locust` to benchmark the API:

```bash
pip install locust
```

Create `locustfile.py`:

```python
from locust import HttpUser, task, between
import json

class GraphIDSUser(HttpUser):
    wait_time = between(1, 2)
    
    @task
    def classify_flows(self):
        flows = [
            {
                "timestamp": 1711491600.0 + i,
                "src_ip": f"192.168.1.{i % 255}",
                "dst_ip": f"8.8.8.{i % 255}",
                "src_port": 54320 + i,
                "dst_port": 443,
                "protocol": 6,
                "bytes": 5000,
                "packets": 10,
            }
            for i in range(10)
        ]
        self.client.post("/classify", json={"flows": flows})
    
    @task(2)
    def get_stats(self):
        self.client.get("/stats")
```

Run load test:
```bash
locust -f locustfile.py -u 50 -r 10 --host http://127.0.0.1:8000
```

Open `http://127.0.0.1:8089` to watch real-time metrics.

---

## 🔍 Troubleshooting

### Backend Issues

#### 1. Port already in use

```bash
# Check what's using port 8000
lsof -i :8000
# Kill process
kill -9 <PID>
```

#### 2. Model not loading

```bash
# Check paths in config_dashboard.yaml
python -c "from pathlib import Path; print(Path('checkpoints/GraphIDS_NF-UNSW-NB15-v3_42.ckpt').exists())"
```

#### 3. CUDA errors

```bash
# Fall back to CPU
# Edit serve.py or set env var:
MODEL_DEVICE=cpu python serve.py
```

### Frontend Issues

#### 1. Blank page or no data

- Check browser console for errors (F12)
- Ensure backend is running: `curl http://127.0.0.1:8000/health`
- Check CORS: backend should return `Access-Control-Allow-Origin: *`

#### 2. API calls failing

- Verify `REACT_APP_API_URL` in frontend `.env`
- Check network tab in DevTools (F12 > Network)
- Look for 404 or 500 errors

#### 3. Styles not loading

```bash
# Rebuild Tailwind CSS
cd frontend && npm run build
```

### Data Issues

#### 1. No anomalies showing

- Model may be too conservative; check threshold in `serve.py`
- Incoming data may all be benign (normal)
- Review `score` distribution in Dashboard > Anomaly Score Distribution chart

#### 2. High latency

- Reduce `window_size` in config (faster but less accurate)
- Check CPU/GPU utilization
- Increase batch size

---

## 📈 Monitoring in Production

### Prometheus Metrics

Backend exposes metrics at `/metrics`:

```bash
curl http://127.0.0.1:8000/metrics
```

Example:
```
# HELP graphids_flows_total Total flows processed
# TYPE graphids_flows_total counter
graphids_flows_total 1234

# HELP graphids_anomalies_detected Total anomalies detected
# TYPE graphids_anomalies_detected counter
graphids_anomalies_detected 45

# HELP graphids_processing_time Processing time ms
# TYPE graphids_processing_time histogram
graphids_processing_time_bucket{le="10"} 100
```

Scrape with Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'graphids'
    static_configs:
      - targets: ['127.0.0.1:8000']
```

### Alerting Rules

Example Prometheus alert:

```yaml
groups:
  - name: graphids
    rules:
      - alert: HighAnomalyRate
        expr: graphids_anomaly_rate > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High anomaly rate detected ({{ $value | humanizePercentage }})"
```

---

## 📝 Example Notebooks

See `tests/` directory for example test cases and integration examples.

---

**Happy testing! 🚀**
