Given ground truth always available and human decision required, the right approach is Approach B — windowed FPR — combined with a clear alert mechanism. Here is the exact implementation.

What Needs to Change and Where
Four files are touched: stream.py, serve.py, models.py, and a new alert.py.

Step 1 — Windowed FPR Tracking in stream.py
The current cumulative FPR dilutes early degradation over time. A model that performed well for 10,000 flows but has been broken for the last 500 will still show a healthy cumulative FPR. The windowed version shows what is happening right now.
Find StreamProcessor.__init__ and add after the existing counter declarations:
python# Windowed FPR tracking
import time as _time
self._fpr_window_sec = 300          # 5-minute rolling window
self._windowed_events = deque()     # (timestamp, gt_label, predicted_label)

# Alert state
self._alert_active = False
self._alert_triggered_at: Optional[float] = None
self._alert_fpr_value: Optional[float] = None
self._alert_threshold: Optional[float] = None
self._alert_history: deque = deque(maxlen=100)  # last 100 alerts
Find the confusion matrix update block in process_flows. It currently does:
pythonif predicted == 1 and window_gt == 1:
    self.true_positives += 1
elif predicted == 1 and window_gt == 0:
    self.false_positives += 1
elif predicted == 0 and window_gt == 1:
    self.false_negatives += 1
elif predicted == 0 and window_gt == 0:
    self.true_negatives += 1
Add one line after each counter increment to also record the windowed event:
pythonimport time as _time

if predicted == 1 and window_gt == 1:
    self.true_positives += 1
    self._windowed_events.append((_time.time(), window_gt, predicted))
elif predicted == 1 and window_gt == 0:
    self.false_positives += 1
    self._windowed_events.append((_time.time(), window_gt, predicted))
elif predicted == 0 and window_gt == 1:
    self.false_negatives += 1
    self._windowed_events.append((_time.time(), window_gt, predicted))
elif predicted == 0 and window_gt == 0:
    self.true_negatives += 1
    self._windowed_events.append((_time.time(), window_gt, predicted))
Add this method to StreamProcessor:
pythondef get_windowed_fpr(self) -> float:
    """
    FPR computed over the last _fpr_window_sec seconds only.
    Evicts events older than the window before computing.
    Returns 0.0 if insufficient data.
    """
    import time as _time
    cutoff = _time.time() - self._fpr_window_sec

    # Evict stale events in-place
    while self._windowed_events and self._windowed_events[0][0] < cutoff:
        self._windowed_events.popleft()

    fp = sum(1 for _, gt, pred in self._windowed_events if gt == 0 and pred == 1)
    tn = sum(1 for _, gt, pred in self._windowed_events if gt == 0 and pred == 0)

    if fp + tn == 0:
        return 0.0
    return fp / (fp + tn)

def get_windowed_stats(self) -> dict:
    """Full windowed confusion matrix over current window."""
    import time as _time
    cutoff = _time.time() - self._fpr_window_sec

    events = [(gt, pred) for t, gt, pred in self._windowed_events if t >= cutoff]

    tp = sum(1 for gt, pred in events if gt == 1 and pred == 1)
    fp = sum(1 for gt, pred in events if gt == 0 and pred == 1)
    tn = sum(1 for gt, pred in events if gt == 0 and pred == 0)
    fn = sum(1 for gt, pred in events if gt == 1 and pred == 0)

    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    f1 = (
        2 * precision * tpr / (precision + tpr)
        if (precision + tpr) > 0 else 0.0
    )

    return {
        "window_sec": self._fpr_window_sec,
        "window_event_count": len(events),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "fpr": round(fpr, 4),
        "tpr": round(tpr, 4),
        "precision": round(precision, 4),
        "f1": round(f1, 4),
    }

Step 2 — Alert Logic in stream.py
Add this method to StreamProcessor. It checks the windowed FPR after every batch and fires an alert if the threshold is crossed. Once an alert is active, it does not fire again until the human acknowledges it:
pythondef check_and_fire_alert(self) -> Optional[dict]:
    """
    Called after every process_flows batch.
    Returns an alert dict if threshold just crossed, None otherwise.
    Alert stays active until acknowledged — does not spam.
    """
    if self.retraining_threshold_fpr is None:
        return None

    windowed_fpr = self.get_windowed_fpr()

    # Check if threshold is crossed
    threshold_crossed = windowed_fpr > self.retraining_threshold_fpr

    if threshold_crossed and not self._alert_active:
        import time as _time
        # Transition: healthy → alert
        self._alert_active = True
        self._alert_triggered_at = _time.time()
        self._alert_fpr_value = windowed_fpr
        self._alert_threshold = self.retraining_threshold_fpr

        alert = {
            "alert_id": f"alert_{int(self._alert_triggered_at * 1000)}",
            "triggered_at": self._alert_triggered_at,
            "windowed_fpr": round(windowed_fpr, 4),
            "threshold": self.retraining_threshold_fpr,
            "window_sec": self._fpr_window_sec,
            "windowed_stats": self.get_windowed_stats(),
            "cumulative_stats": {
                "tp": self.true_positives,
                "fp": self.false_positives,
                "tn": self.true_negatives,
                "fn": self.false_negatives,
            },
            "message": (
                f"Windowed FPR {windowed_fpr:.2%} exceeded threshold "
                f"{self.retraining_threshold_fpr:.2%} over the last "
                f"{self._fpr_window_sec}s. Human review required."
            ),
            "acknowledged": False,
        }

        self._alert_history.append(alert)
        logger.warning(alert["message"])
        return alert

    elif not threshold_crossed and self._alert_active:
        # FPR recovered without acknowledgment — auto-clear
        self._alert_active = False
        logger.info(
            f"Windowed FPR recovered to {windowed_fpr:.2%} "
            f"(below threshold {self.retraining_threshold_fpr:.2%}). Alert cleared."
        )

    return None

def acknowledge_alert(self) -> bool:
    """
    Human acknowledges the active alert.
    Clears alert state so a new alert can fire if FPR rises again.
    Returns True if there was an active alert to acknowledge.
    """
    if not self._alert_active:
        return False

    self._alert_active = False
    self._alert_triggered_at = None
    self._alert_fpr_value = None
    logger.info("Retraining alert acknowledged by operator.")
    return True
Now call check_and_fire_alert at the end of process_flows, just before return results:
python# At the end of process_flows, before return
self.check_and_fire_alert()
self.total_flows += len(flows)
return results

Step 3 — Update get_stats in stream.py
Add windowed metrics and alert state to the existing get_stats return dict:
pythondef get_stats(self) -> dict:
    # ... existing code unchanged above ...

    windowed = self.get_windowed_stats()

    return {
        # ... all existing keys unchanged ...

        # ADD these keys:
        "windowed_fpr": windowed["fpr"],
        "windowed_tpr": windowed["tpr"],
        "windowed_precision": windowed["precision"],
        "windowed_f1": windowed["f1"],
        "windowed_window_sec": windowed["window_sec"],
        "windowed_event_count": windowed["window_event_count"],
        "alert_active": self._alert_active,
        "alert_triggered_at": self._alert_triggered_at,
        "alert_fpr_value": self._alert_fpr_value,
        "alert_threshold": self._alert_threshold,
    }

Step 4 — New Endpoints in serve.py
Add three endpoints after the existing /retraining-threshold endpoints:
python@app.get("/alert", tags=["Monitoring"])
async def get_alert_status() -> dict:
    """
    Get current retraining alert status.
    Poll this endpoint from the dashboard to check for active alerts.
    """
    global stream_processor

    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    windowed = stream_processor.get_windowed_stats()

    return {
        "alert_active": stream_processor._alert_active,
        "alert_triggered_at": stream_processor._alert_triggered_at,
        "alert_fpr_value": stream_processor._alert_fpr_value,
        "alert_threshold": stream_processor._alert_threshold,
        "windowed_fpr": windowed["fpr"],
        "windowed_stats": windowed,
        "message": (
            stream_processor._alert_history[-1]["message"]
            if stream_processor._alert_active and stream_processor._alert_history
            else None
        ),
        "recent_alerts": [
            {
                "alert_id": a["alert_id"],
                "triggered_at": a["triggered_at"],
                "windowed_fpr": a["windowed_fpr"],
                "threshold": a["threshold"],
            }
            for a in list(stream_processor._alert_history)[-10:]
        ],
    }


@app.post("/alert/acknowledge", tags=["Monitoring"])
async def acknowledge_alert() -> dict:
    """
    Human operator acknowledges the active retraining alert.
    Clears the alert so a new one can fire if FPR rises again.
    Call this after a human reviews the situation and decides
    whether to retrain or continue monitoring.
    """
    global stream_processor

    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    was_active = stream_processor.acknowledge_alert()

    if was_active:
        return {
            "status": "acknowledged",
            "message": "Alert acknowledged. System will re-alert if FPR rises again.",
        }
    else:
        return {
            "status": "no_active_alert",
            "message": "No active alert to acknowledge.",
        }


@app.post("/alert/threshold", tags=["Monitoring"])
async def set_alert_threshold(
    threshold_fpr: float = Query(..., ge=0.0, le=1.0),
    window_sec: int = Query(300, ge=60, le=3600),
) -> dict:
    """
    Set windowed FPR threshold and observation window for alerting.

    threshold_fpr: FPR value above which alert fires (e.g. 0.05 = 5%)
    window_sec: rolling window duration in seconds (default 300 = 5 minutes)
    """
    global stream_processor

    if stream_processor is None:
        raise HTTPException(status_code=503, detail="Stream processor not initialized")

    stream_processor.set_retraining_threshold(threshold_fpr)
    stream_processor._fpr_window_sec = window_sec

    return {
        "status": "set",
        "threshold_fpr": threshold_fpr,
        "window_sec": window_sec,
        "message": (
            f"Alert will fire when windowed FPR exceeds {threshold_fpr:.2%} "
            f"over any {window_sec}s window."
        ),
    }
Also add alert/acknowledge and alert/threshold to the /reset endpoint so test runs start clean:
python# Inside the /reset handler, add:
stream_processor._alert_active = False
stream_processor._alert_triggered_at = None
stream_processor._alert_fpr_value = None
stream_processor._alert_history.clear()
stream_processor._windowed_events.clear()

Step 5 — Update models.py
Add windowed fields to DashboardStats:
pythonclass DashboardStats(BaseModel):
    # ... all existing fields unchanged ...

    # Windowed metrics (rolling window, not cumulative)
    windowed_fpr: float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_tpr: float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_precision: float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_f1: float = Field(default=0.0, ge=0.0, le=1.0)
    windowed_window_sec: int = Field(default=300)
    windowed_event_count: int = Field(default=0)

    # Alert state
    alert_active: bool = Field(default=False)
    alert_triggered_at: Optional[float] = Field(default=None)
    alert_fpr_value: Optional[float] = Field(default=None)
    alert_threshold: Optional[float] = Field(default=None)
Update get_statistics in serve.py to pass the new fields:
pythonreturn DashboardStats(
    # ... all existing fields unchanged ...
    windowed_fpr=stats["windowed_fpr"],
    windowed_tpr=stats["windowed_tpr"],
    windowed_precision=stats["windowed_precision"],
    windowed_f1=stats["windowed_f1"],
    windowed_window_sec=stats["windowed_window_sec"],
    windowed_event_count=stats["windowed_event_count"],
    alert_active=stats["alert_active"],
    alert_triggered_at=stats["alert_triggered_at"],
    alert_fpr_value=stats["alert_fpr_value"],
    alert_threshold=stats["alert_threshold"],
)

How the Human Workflow Looks
Operator sets threshold:
POST /alert/threshold?threshold_fpr=0.05&window_sec=300

System runs normally. Dashboard polls /alert every 5s.

FPR rises above 5% in the last 5 minutes:
GET /alert → { "alert_active": true, "windowed_fpr": 0.087, "message": "..." }

Operator reviews the windowed stats.
Decides to retrain → runs training pipeline externally.
OR decides to keep monitoring → acknowledges to silence alert.

POST /alert/acknowledge → { "status": "acknowledged" }

System continues. Will re-alert if FPR rises again.

What Is Not Implemented Here (Intentionally)
The actual retraining trigger — launching the training pipeline — is not automated. The acknowledge endpoint is the decision point. After acknowledgment the operator runs retraining manually. Automating it would require the training pipeline to be callable as a subprocess or API, which is a separate decision involving how long training takes on your hardware and whether you want the demo backend to stay live during retraining.