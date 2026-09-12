# GraphIDS Real-Time Dashboard - Integrated Project

A real-time network intrusion detection dashboard powered by **GraphIDS**, a self-supervised Graph Neural Network model for anomaly detection in NetFlow data.

## Demo 


https://github.com/user-attachments/assets/1ba199bd-5820-40a2-b6ce-8f270e6ef5c9


##  Project Structure

```
project/
├── frontend/              # React + TypeScript + Vite (Modern UI)
│   ├── src/
│   │   ├── app/          # Application logic (components, pages, context)
│   │   ├── styles/       # Global styles and theme configuration
│   │   └── main.tsx      # React entry point
│   ├── package.json      # Frontend dependencies
│   ├── vite.config.ts    # Vite build configuration
│   └── index.html        # HTML template
│
├── backend/              # FastAPI Python server
│   ├── serve.py          # Main FastAPI application
│   ├── models.py         # Pydantic request/response schemas
│   ├── inference.py      # GraphIDS model inference engine
│   ├── stream.py         # Real-time NetFlow preprocessing
│   ├── requirements.txt   # Python dependencies
│   └── README.md         # Backend documentation
│
├── data/                 # NetFlow datasets
├── checkpoints/          # Trained GraphIDS model checkpoints
├── models/               # Pre-trained models and scalers
├── guidelines/           # Development guidelines
│
├── .env                  # Environment configuration (local)
├── .env.example          # Environment configuration template
└── README.md             # This file
```

##  Quick Start

### Prerequisites

- **Frontend**: Node.js 16+ and npm/yarn
- **Backend**: Python 3.8+
- **Trained Model**: `checkpoints/GraphIDS_NF-UNSW-NB15-v3_42.ckpt`

### Backend Setup

1. Install Python dependencies:

```bash
cd backend
pip install -r requirements.txt
```

2. Start the FastAPI server:

```bash
python serve.py
```

The backend will be available at `http://localhost:8000`

### Frontend Setup

1. Install Node dependencies:

```bash
cd frontend
npm install
```

2. Start the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

## 🔗 API Integration

The frontend automatically connects to the backend using the API base URL configured in `.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

### Supported Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/stats` | GET | Dashboard statistics and metrics |
| `/events` | GET | Recent classification events |
| `/health` | GET | System health check |

### Data Flow

```
NetFlow Data → Backend Preprocessing → GraphIDS Model
    ↓
Classification Results → WebSocket/REST API
    ↓
Frontend Dashboard → Display Alerts & Analytics
```

## 🛠️ Development

### Frontend Development

```bash
cd frontend
npm run dev        # Start dev server (hot reload)
npm run build      # Build for production
npm run preview    # Preview production build
```

### Backend Development

```bash
cd backend
python serve.py    # Start with default settings
# Or with custom logging:
LOG_LEVEL=DEBUG python serve.py
```

##  Key Features

### Frontend
- **Real-time Dashboard**: Live statistics and anomaly visualization
- **Alerts Management**: Severity-based alert filtering and acknowledgment
- **Flow Analysis**: Detailed network flow inspection with metrics
- **Graph Visualization**: Network topology and embedding space visualization
- **Log Management**: Comprehensive security event logging
- **Authentication**: Role-based access control (Admin/Analyst)
- **Responsive Design**: Works on desktop and tablet devices

### Backend
- **Real-time Processing**: Sub-second latency anomaly detection
- **GraphIDS Model**: Self-supervised learning approach for unseen attacks
- **Feature Extraction**: Automated NetFlow feature engineering
- **Stream Processing**: Sliding window buffer with deduplication
- **Health Monitoring**: System status and component health tracking
- **CORS Support**: Cross-origin requests for frontend integration

## ⚙️ Configuration


### Model Configuration

Backend model paths are configured in `backend/serve.py`:

```python
model_checkpoint_path = "/path/to/GraphIDS_NF-UNSW-NB15-v3_42.ckpt"
model_scaler_path = "/path/to/NF-UNSW-NB15-v3/scaler.pkl"
```

## 📚 Documentation

- Self-Supervised Learning of Graph Representations for Network Intrusion Detection(https://github.com/lorenzo9uerra/GraphIDS)

