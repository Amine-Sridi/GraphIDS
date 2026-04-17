# GraphIDS Real-Time Dashboard - Integrated Project

A production-ready real-time network intrusion detection dashboard powered by **GraphIDS**, a self-supervised Graph Neural Network model for anomaly detection in NetFlow data.

## 📁 Project Structure

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

## 🚀 Quick Start

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

## 📊 Key Features

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

### Environment Variables

Create a `.env` file in the project root (template provided in `.env.example`):

```env
# Frontend API endpoint
VITE_API_BASE_URL=http://localhost:8000

# Backend settings (if modifying)
BACKEND_HOST=localhost
BACKEND_PORT=8000
BACKEND_LOG_LEVEL=WARNING
```

### Model Configuration

Backend model paths are configured in `backend/serve.py`:

```python
model_checkpoint_path = "/path/to/GraphIDS_NF-UNSW-NB15-v3_42.ckpt"
model_scaler_path = "/path/to/NF-UNSW-NB15-v3/scaler.pkl"
```

## 📚 Documentation

- **[Backend Overview](backend/README.md)** - Detailed backend architecture
- **[Backend Implementation](backend/ARCHITECTURE.md)** - Technical implementation details
- **[Frontend Architecture](frontend/README.md)** - Frontend structure and components
- **[Backend Testing Guide](backend/TESTING.md)** - Testing procedures

## 🧪 Testing

### Test the API Endpoints

```bash
# Health check
curl http://localhost:8000/health

# Get dashboard stats
curl http://localhost:8000/stats

# Get recent events
curl http://localhost:8000/events?limit=10
```

### Test Frontend Integration

1. Ensure backend is running on `http://localhost:8000`
2. Start frontend with `npm run dev`
3. Login with credentials:
   - Username: `admin`
   - Password: `NetGuard@2025`
4. View real-time dashboard

## 🔐 Security

- **Authentication**: Session-based with 30-minute timeout
- **CORS**: Configured for frontend-backend communication
- **Model Safety**: Input validation and error handling
- **Logging**: Comprehensive audit logging (configurable level)

## 🤝 Contributing

For development guidelines, see [Guidelines](guidelines/Guidelines.md)

## 📄 License

See LICENSE file in the project root

## 📞 Support

For issues or questions:
1. Check the backend testing guide: `backend/TESTING.md`
2. Review available documentation in respective folders
3. Check logs for error messages

---

**Last Updated**: April 2026  
**Status**: Production Ready ✓
