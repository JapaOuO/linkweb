from contextlib import asynccontextmanager
import uuid

from fastapi import FastAPI, HTTPException
from fastapi import Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .firebase import FirebaseStore
from .models import ClientMeasurement, MonitorCreateRequest, MonitorStatus
from .monitor import MonitorManager

store = FirebaseStore()
manager = MonitorManager(store)
recent_measurements: list[dict] = []


def get_measurement_id(item: dict) -> str:
    if "id" not in item:
        item["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "|".join([
            str(item.get("device_id", "")),
            str(item.get("timestamp", "")),
            str(item.get("samples_sent", "")),
        ])))
    return item["id"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    for job in manager.list_jobs():
        await manager.stop(job.monitor_id)


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def status_for(job) -> MonitorStatus:
    return MonitorStatus(
        monitor_id=job.monitor_id,
        target=job.target,
        interval_seconds=job.interval_seconds,
        pings_per_measurement=job.pings_per_measurement,
        include_speed_test=job.include_speed_test,
        state=job.state,
        last_measurement=job.last_measurement,
        error=job.error,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/measurement-download")
def measurement_download() -> Response:
    # A fixed payload makes the browser-side throughput calculation repeatable.
    return Response(content=b"0" * (512 * 1024), media_type="application/octet-stream",
                    headers={"Cache-Control": "no-store"})


@app.post("/api/measurement-upload")
def measurement_upload(payload: bytes) -> dict[str, int]:
    return {"bytes_received": len(payload)}


@app.post("/api/client-measurements", status_code=202)
def receive_client_measurement(measurement: ClientMeasurement) -> dict[str, str]:
    data = measurement.model_dump(mode="json")
    data["id"] = str(uuid.uuid4())
    recent_measurements.append(data)
    del recent_measurements[:-5000]
    store.save_client_measurement(data)
    return {"status": "accepted"}


@app.delete("/api/client-measurements/{measurement_id}", status_code=204)
def delete_client_measurement(measurement_id: str) -> None:
    global recent_measurements
    for item in recent_measurements:
        get_measurement_id(item)
    recent_measurements = [item for item in recent_measurements if item["id"] != measurement_id]
    store.delete_client_measurement(measurement_id)


@app.delete("/api/client-measurements", status_code=204)
def delete_all_client_measurements() -> None:
    recent_measurements.clear()
    store.delete_all_client_measurements()


@app.get("/api/client-measurements")
def list_client_measurements(
    device_type: str | None = Query(default=None),
    connection_type: str | None = Query(default=None),
    latency_target: str | None = Query(default=None),
) -> list[dict]:
    measurements = recent_measurements or store.list_client_measurements()
    for item in measurements:
        get_measurement_id(item)
    return [
        item for item in measurements
        if (not device_type or item["device_type"] == device_type)
        and (not connection_type or item["connection_type"] == connection_type)
        and (not latency_target or item["latency_target"] == latency_target)
    ]


@app.post("/api/monitors", response_model=MonitorStatus, status_code=201)
async def create_monitor(request: MonitorCreateRequest) -> MonitorStatus:
    job = await manager.start(
        request.target, request.interval_seconds, request.pings_per_measurement, request.include_speed_test
    )
    return status_for(job)


@app.get("/api/monitors", response_model=list[MonitorStatus])
def list_monitors() -> list[MonitorStatus]:
    return [status_for(job) for job in manager.list_jobs()]


@app.get("/api/monitors/{monitor_id}", response_model=MonitorStatus)
def get_monitor(monitor_id: str) -> MonitorStatus:
    job = manager.get(monitor_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")
    return status_for(job)


@app.delete("/api/monitors/{monitor_id}", status_code=204)
async def stop_monitor(monitor_id: str) -> None:
    if not await manager.stop(monitor_id):
        raise HTTPException(status_code=404, detail="Monitor não encontrado")
