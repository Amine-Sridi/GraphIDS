# GraphIDS Real-Time IDS Dashboard

A production-ready real-time network intrusion detection dashboard powered by **GraphIDS**, a self-supervised Graph Neural Network model for anomaly detection in NetFlow data.

## 📋 Overview

This dashboard provides:

- **Real-time anomaly detection** using a trained GraphIDS model
- **RESTful API** (`serve.py`) for flow classification and monitoring
- **Interactive React frontend** with live statistics, alerts, and event streaming
- **Scalable architecture** with async I/O, sliding window buffering, and configurable thresholds
- **Comprehensive logging** and health monitoring

## 🏗️ Architecture

### Backend (Python/FastAPI)

```
dashboard/
├── serve.py              # FastAPI server (main entry point)
├── models.py             # Pydantic request/response models
├── inference.py          # Model loading and inference engine
├── stream.py             # Real-time preprocessing and streaming
├── requirements.txt      # Python dependencies
└── config_dashboard.yaml # Configuration (in repo root)
```

**Key Components:**

- **`serve.py`**: FastAPI server with endpoints for classification, monitoring, and health checks
- **`inference.py`**: Wraps GraphIDS model checkpoint and scaler; handles preprocessing
- **`stream.py`**: Real-time NetFlow preprocessing, node mapping, sliding window buffering
- **`models.py`**: Request/response schemas (NetFlow, Classification, Events, Stats, Health)

### Frontend (React + Vite)

```
dashboard/frontend/
├── src/
│   ├── main.jsx          # Entry point
│   ├── App.jsx           # Main app component (state management)
│   ├── App.css           # Main styles
│   ├── api.js            # API client (axios)
│   ├── index.css         # Global styles
│   └── components/
│       ├── Header.jsx    # Header with branding
│       ├── Dashboard.jsx # Overview dashboard with stats and charts
│       ├── EventsTable.jsx # Detailed event listing with filters
│       ├── StatsPanel.jsx   # Detailed statistics and health indicators
│       ├── AnomalyChart.jsx # Chart.js visualization
│       ├── HealthIndicator.jsx
│       └── *.css         # Component-specific styles
├── index.html            # HTML template
├── package.json          # Dependencies and scripts
├── vite.config.js        # Vite build config
└── .env.example          # Environment variables template
```

**Key Features:**

- **Live data refresh**: Polls `/stats` and `/events` every 2 seconds
- **Multi-tab interface**: Dashboard, Events, Statistics views
- **Interactive charts**: Anomaly score distribution using Chart.js
- **Severity indicators**: Color-coded alerts (red=high, orange=medium, green=low)
- **Health monitoring**: Real-time backend status and component state
- **Responsive design**: Mobile-friendly with Tailwind CSS

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- Node.js 16+
- Trained GraphIDS checkpoint (`checkpoints/GraphIDS_NF-UNSW-NB15-v3_42.ckpt`)
- Scaler pickle (`data/pyg_graph_data/NF-UNSW-NB15-v3/scaler.pkl`)

### Backend Setup

1. Install Python dependencies:

```bash
cd dashboard
pip install -r requirements.txt
```

2. Update configuration if needed:

```yaml
# Edit ../config_dashboard.yaml
model:
  checkpoint_path: "checkpoints/GraphIDS_NF-UNSW-NB15-v3_42.ckpt"
  scaler_path: "data/pyg_graph_data/NF-UNSW-NB15-v3/scaler.pkl"
  device: "cuda"  # or "cpu"
```

3. Start the API server:

```bash
python serve.py
# Server runs on http://127.0.0.1:8000
# API docs: http://127.0.0.1:8000/docs
```

### Frontend Setup

1. Install dependencies:

```bash
cd frontend
npm install
```

2. Create `.env` file:

```bash
cp .env.example .env
# Update REACT_APP_API_URL if backend is not on localhost:8000
```

3. Start development server:

```bash
npm run dev
# Open http://127.0.0.1:3000 in browser
```

4. Build for production:

```bash
npm run build
# Output: frontend/dist/
```

## 📡 API Endpoints

### Classification

- **POST** `/classify`
  - Classify a batch of NetFlow records
  - Request: `FlowBatchRequest` with list of flows
  - Response: `FlowBatchResponse` with scores, labels, and processing time

Example:

```bash
curl -X POST http://127.0.0.1:8000/classify \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

### Monitoring

- **GET** `/events?limit=50&min_score=0.0&label=1`
  - Get recent classification events with filtering
  - Query params: `limit` (1-1000), `min_score` (0-1), `label` (0 or 1)

- **GET** `/stats`
  - Get dashboard statistics (flows, anomalies, nodes, uptime)

- **GET** `/health`
  - Health check (model loaded, scaler ready, status)

- **GET** `/model-info`
  - Model metadata and configuration

- **GET** `/metrics`
  - API metrics (requests, errors, uptime)

### System

- **POST** `/reset`
  - Reset stream processor (clear buffers, reset counters)

## 🔧 Configuration

Edit `config_dashboard.yaml` (in repo root) to customize:

```yaml
model:
  checkpoint_path: ...          # Path to .ckpt file
  scaler_path: ...              # Path to scaler.pkl
  device: "cuda" or "cpu"       # torch device
  
streaming:
  window_size: 32               # Transformer input length
  step_percent: 0.5             # Sliding window overlap (50%)
  buffer_size: 1000             # Max flows in memory
  anomaly_threshold: null       # Auto-loaded from checkpoint

api:
  host: "127.0.0.1"
  port: 8000
  workers: 1

dashboard:
  refresh_interval_ms: 1000     # Poll interval (ms)
  chart_history_minutes: 30     # Show 30min history
```

## 📊 Understanding the Dashboard

### Main Views

1. **Dashboard**
   - Top stat cards: total flows, anomalies, active nodes
   - Anomaly score distribution chart
   - Alert severity breakdown
   - Recent anomalies (top 5)
   - System status

2. **Events**
   - Comprehensive event table with all classifications
   - Filters: anomalies, benign flows
   - Sort: by timestamp or score
   - Display: IP:port pairs, scores, confidence, window IDs

3. **Statistics**
   - Detailed model info and status
   - Processing statistics and buffer state
   - Health status of all components
   - Performance insights and trends

### Color Coding

- **Green**: Benign traffic or healthy components
- **Orange**: Medium severity or degraded status
- **Red**: Anomalous traffic or errors

## 🔄 Data Flow

1. **Incoming NetFlow record** → `POST /classify`
2. **Backend preprocessing**:
   - Extract fields and normalize
   - Map IPs to node IDs
   - Scale features with trained scaler
3. **Inference**:
   - Encode edges with SAGELayer
   - Add to rolling buffer
   - Generate sliding windows
   - Run transformer auto-encoder
   - Compute reconstruction errors → anomaly scores
4. **Response**:
   - Return score, label, confidence per flow
   - Store in `recent_events` (last 500)
5. **Frontend polling**:
   - `/stats` every 2s → update charts
   - `/events` every 2s → update tables

## 🚨 Troubleshooting

### Backend fails to start

- Check Python version: `python --version` (need 3.8+)
- Verify checkpoint and scaler paths in `config_dashboard.yaml`
- Confirm CUDA availability if using GPU: `python -c "import torch; print(torch.cuda.is_available())"`

### No anomalies detected

- Normal if training data was mostly benign
- Check threshold calculation in `inference.py`
- Review anomaly score distribution in "Dashboard" > "Anomaly Score Distribution" chart

### Frontend can't connect to backend

- Ensure backend is running on correct host/port
- Check `REACT_APP_API_URL` in frontend `.env`
- Look for CORS errors in browser console
- Backend CORS is permissive in `serve.py`; configure if needed

### High latency

- Reduce `window_size` for faster decisions (trades accuracy)
- Increase `batch_size` for GPU throughput
- Check system resources (CPU, GPU, RAM)

## 📈 Performance Tips

1. **For real-time responsiveness**:
   - Use smaller `window_size` (e.g., 16 vs 32)
   - Reduce `step_percent` for more frequent windows
   - Run on GPU with CUDA

2. **For accuracy**:
   - Use larger `window_size` for temporal context
   - Keep `step_percent` at 0.5 (50% overlap)
   - Train on representative benign data

3. **For scalability**:
   - Run multiple API workers behind a load balancer
   - Deploy frontend as static files (nginx, CDN)
   - Use external DB for event logging (not included)

## 🔐 Security Notes

- **CORS**: Currently allows all origins; restrict in production
- **Authentication**: Not implemented; add before exposing to public
- **Data validation**: Pydantic models validate all inputs
- **Rate limiting**: Not enforced; add if needed
- **Logging**: Sensitive data (IPs) is logged; redact in production

## 🧪 Testing

```bash
# Test API with sample flow
curl -X POST http://127.0.0.1:8000/classify \
  -H "Content-Type: application/json" \
  -d @sample_flow.json

# Get recent events
curl http://127.0.0.1:8000/events?limit=10

# Health check
curl http://127.0.0.1:8000/health
```

## 📝 Logging

- Backend logs to console (configurable in `serve.py`)
- Frontend console logs in browser DevTools
- Enable verbose logging in `config_dashboard.yaml`

## 🔄 Deployment

### Docker (Optional)

See `Dockerfile` and `docker-compose.yml` if available.

### Manual Deployment

1. Package frontend: `cd frontend && npm run build`
2. Deploy `dist/` to static file server (nginx, S3)
3. Run backend on production server with `gunicorn` or similar:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 serve:app
```

### Environment Variables

Backend reads from `/config_dashboard.yaml` and `.env`:

```bash
MODEL_CHECKPOINT_PATH=...
MODEL_SCALER_PATH=...
MODEL_DEVICE=cuda
API_HOST=0.0.0.0
API_PORT=8000
```

## 📚 Further Documentation

- **GraphIDS Guide**: [docs/GRAPHIDS_GUIDE.md](../docs/GRAPHIDS_GUIDE.md)
- **FastAPI Docs**: `http://127.0.0.1:8000/docs` (Swagger UI)
- **Model Code**: [models/graphids.py](../models/graphids.py)
- **Training**: [main.py](../main.py)

## 🤝 Contributing

Improvements welcome! Areas for extension:

- Real-time feature extraction from raw pcap/sflow
- Time-series anomaly trends
- Automated retraining triggers
- Advanced filtering and search
- Integration with SIEM/alerting systems

## 📄 License

See [LICENSE](../LICENSE)

---

**Built with ❤️ for network security**
