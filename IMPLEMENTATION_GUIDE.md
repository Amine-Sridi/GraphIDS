# Frontend-Backend Connection: Implementation Guide

This guide shows you exactly how to connect the React frontend to the FastAPI backend and start seeing real data.

## Current State ✅

- ✅ Frontend is in `/project/frontend` with mock data working
- ✅ Backend is in `/project/backend` with real GraphIDS model ready
- ✅ API client is created and ready to use

## The Challenge

The frontend currently uses **mock data** from `SimulationContext`. We need to switch it to use **real data from the backend**.

## Solution: Three Options

### Option A: Simple & Recommended 👍
Use the existing `SimulationContext` for mock data, but fetch real data from backend in parallel.

**Pros**: Minimal changes, works even if backend is down  
**Cons**: Shows both mock and real data

**Implementation**: Quick, 10 minutes

---

### Option B: Real Data with Fallback 
Fetch real data from backend, fall back to mock data if unavailable.

**Pros**: Real data when available, never breaks  
**Cons**: Slightly more complex

**Implementation**: Medium, 20 minutes

---

### Option C: Complete Backend Integration 
Replace mock data entirely with backend API.

**Pros**: Clean, production-ready  
**Cons**: Must have backend running

**Implementation**: Advanced, 30 minutes

---

## Option A: Quick Start (Recommended for Testing)

### Step 0: Verify Setup

Ensure `.env` is configured:
```env
VITE_API_BASE_URL=http://localhost:8000
VITE_API_TIMEOUT=5000
```

### Step 1: Start Backend

```bash
cd project/backend
python serve.py
```

Verify it's running:
```bash
curl http://localhost:8000/health
# Should return {"status": "healthy", ...}
```

### Step 2: Update Frontend Startup Message

Edit `frontend/src/app/components/IDSDashboard.tsx`:

Add this code after the imports:

```typescript
import { isBackendAvailable, getApiBaseUrl } from '../utils/api';

// Inside the IDSDashboard component, add useEffect:
useEffect(() => {
  isBackendAvailable().then(available => {
    if (available) {
      console.log('✅ Backend connected at:', getApiBaseUrl());
    } else {
      console.log('⚠️  Backend unavailable, using mock data');
    }
  });
}, []);
```

### Step 3: Start Frontend

```bash
cd project/frontend
npm install  # if not done yet
npm run dev
```

### Step 4: View Console

In browser, press `F12` → Console tab. You should see:
```
✅ Backend connected at: http://localhost:8000
```

**Result**: Frontend now knows about backend and can be extended to use it.

---

## Option B: Real Data with Fallback

This is the **production-recommended approach** because it's robust.

### Step 1: Create BackendContext

Create file: `frontend/src/app/context/BackendContext.tsx`

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { graphIdsApi, isBackendAvailable } from '../utils/api';
import type { DataPoint, AlertEntry } from '../types';
import type { DashboardStats } from '../utils/api';

interface BackendContextType {
  isConnected: boolean;
  recentEvents: DataPoint[];
  anomalies: AlertEntry[];
  stats: DashboardStats | null;
  error: string | null;
}

const BackendContext = createContext<BackendContextType | null>(null);

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('useBackend must be inside BackendProvider');
  return ctx;
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<DataPoint[]>([]);
  const [anomalies, setAnomalies] = useState<AlertEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check backend availability on mount
  useEffect(() => {
    isBackendAvailable().then(available => {
      setIsConnected(available);
      if (!available) {
        setError('Backend unavailable - using mock data');
      }
    });
  }, []);

  // Poll backend for data if connected
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(async () => {
      try {
        const [statsData, eventsData, anomalyData] = await Promise.all([
          graphIdsApi.getStats(),
          graphIdsApi.getDataPoints(60),
          graphIdsApi.getAnomalies(100),
        ]);

        setStats(statsData);
        setRecentEvents(eventsData);
        setAnomalies(anomalyData);
        setError(null); // Clear any previous errors
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(`Backend error: ${message}`);
        console.error('Backend polling error:', err);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <BackendContext.Provider value={{ isConnected, recentEvents, anomalies, stats, error }}>
      {children}
    </BackendContext.Provider>
  );
}
```

### Step 2: Add Provider to App

Edit `frontend/src/app/App.tsx`:

```typescript
import { BackendProvider } from './context/BackendContext';
import { SimulationProvider } from './context/SimulationContext';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <BackendProvider>
        <SimulationProvider>
          <RouterProvider router={router} />
          {/* ... rest of app ... */}
        </SimulationProvider>
      </BackendProvider>
      <Toaster
        theme="dark"
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: '#161b22',
            border: '1px solid #21262d',
            color: '#e6edf3',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          },
        }}
      />
    </AuthProvider>
  );
}
```

### Step 3: Use in IDSDashboard

Edit the IDSDashboard to prefer backend data:

```typescript
import { useBackend } from '../context/BackendContext';
import { useSimulation } from '../context/SimulationContext';

export function IDSDashboard() {
  const backend = useBackend();
  const simulation = useSimulation();

  // Use backend data if available, otherwise simulation
  const dataPoints = backend.isConnected ? backend.recentEvents : simulation.dataPoints;
  const alerts = backend.isConnected ? backend.anomalies : simulation.alerts;

  // Show connection status
  if (backend.error) {
    console.warn('⚠️', backend.error);
  }

  return (
    <div>
      {backend.error && (
        <div style={{ padding: '12px', background: 'rgba(249,115,22,0.1)', color: '#f97316', borderRadius: '6px' }}>
          {backend.error}
        </div>
      )}
      
      {/* Rest of component using dataPoints and alerts */}
      {/* All existing code continues to work */}
    </div>
  );
}
```

**Result**: Real backend data when available, mock data fallback. **Best for production.**

---

## Option C: Complete Backend Integration

This completely replaces mock data with real data.

### Implementation

```typescript
import { useEffect, useState } from 'react';
import { graphIdsApi } from '../utils/api';
import type { DataPoint, AlertEntry } from '../types';

export function IDSDashboard() {
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [points, anomalies] = await Promise.all([
          graphIdsApi.getDataPoints(60),
          graphIdsApi.getAnomalies(100),
        ]);

        setDataPoints(points);
        setAlerts(anomalies);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 2 seconds
    const interval = setInterval(fetchData, 2000);

    return () => clearInterval(interval);
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  // Render with dataPoints and alerts
  return (
    // ... your existing JSX using dataPoints and alerts
  );
}
```

**Note**: This requires backend to always be running.

---

## Comparing the Options

| Feature | Option A | Option B | Option C |
|---------|----------|----------|----------|
| **Implementation Time** | 5 min | 20 min | 10 min |
| **Complexity** | Simple | Medium | Simple |
| **Backend Required** | No | No | Yes ✅ |
| **Mock Data Fallback** | Yes | Yes | No |
| **Real Data** | No | Yes ✅ | Yes ✅ |
| **Production Ready** | No | Yes ✅ | Yes ✅ |
| **Recommended** | Testing | Production ✅ | Production ✅ |

---

## Testing Your Implementation

### 1. Check Backend is Running

```bash
curl http://localhost:8000/stats
# Should return JSON with statistics
```

### 2. Check Frontend Connects

Browser Console (F12):
```javascript
import { graphIdsApi } from './app/utils/api';

// Test in console
await graphIdsApi.getStats()
// Should log stats object
```

### 3. Monitor Network Tab

Open DevTools → Network tab, reload page:
- Should see requests to `http://localhost:8000/stats`
- Should see requests to `http://localhost:8000/events`
- Both should return 200 with JSON data

### 4. Verify Data Display

Dashboard should show:
- Real anomaly scores (not just random 0-1 values)
- Real IP addresses from your network data
- Update every 2 seconds

---

## Troubleshooting

### "Backend unavailable" Message

**Check**:
1. Backend running? `python serve.py` in `/project/backend`
2. Correct port? Default is `8000`
3. Correct URL in `.env`?

**Fix**:
```bash
# Kill old process if stuck
lsof -ti:8000 | xargs kill -9

# Restart
cd project/backend
python serve.py
```

### API Returns Empty Results

**Check**:
1. Any NetFlow data ingested?
2. Backend logs for errors

**Try**:
```python
# In backend directory
python stream_simulator.py  # Generates test data
```

### CORS Errors in Console

**Fix in `backend/serve.py`**:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### API Timeout

**Increase timeout in `.env`**:
```env
VITE_API_TIMEOUT=10000  # 10 seconds instead of 5
```

---

## Summary

1. **Quick Test (5 min)**: Use **Option A** to verify backend works
2. **Real Data (20 min)**: Implement **Option B** for production-ready dashboard
3. **Alternative**: Use **Option C** if you prefer cleaner code and always have backend running

Choose **Option B** for the best balance of robustness and real data.

---

**Next Steps**:
1. Pick an option above
2. Implement the code
3. Start both backend and frontend
4. Check browser console for connection status
5. Verify data is flowing

Happy integrating! 🚀
