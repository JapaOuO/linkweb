import asyncio
import re
import statistics
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .firebase import FirebaseStore

PING_LINE = re.compile(r"(?:time|tempo)[=<]\s*(\d+(?:[.,]\d+)?)\s*ms", re.IGNORECASE)


def _ping_once(target: str) -> float | None:
    result = subprocess.run(
        ["ping", "-n", "1", "-w", "2000", target],
        capture_output=True,
        text=True,
        timeout=4,
        check=False,
    )
    match = PING_LINE.search(result.stdout + result.stderr)
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


def _speed_test() -> tuple[float | None, float | None]:
    import speedtest

    tester = speedtest.Speedtest(secure=True)
    tester.get_best_server()
    download = tester.download() / 1_000_000
    upload = tester.upload() / 1_000_000
    return round(download, 2), round(upload, 2)


@dataclass
class MonitorJob:
    monitor_id: str
    target: str
    interval_seconds: float
    pings_per_measurement: int
    include_speed_test: bool
    task: asyncio.Task[None] | None = None
    state: str = "running"
    last_measurement: dict[str, Any] | None = None
    error: str | None = None


class MonitorManager:
    def __init__(self, store: FirebaseStore) -> None:
        self._jobs: dict[str, MonitorJob] = {}
        self._store = store

    def list_jobs(self) -> list[MonitorJob]:
        return list(self._jobs.values())

    def get(self, monitor_id: str) -> MonitorJob | None:
        return self._jobs.get(monitor_id)

    async def start(
        self, target: str, interval_seconds: float, pings_per_measurement: int, include_speed_test: bool
    ) -> MonitorJob:
        job = MonitorJob(
            monitor_id=str(uuid.uuid4()),
            target=target,
            interval_seconds=interval_seconds,
            pings_per_measurement=pings_per_measurement,
            include_speed_test=include_speed_test,
        )
        job.task = asyncio.create_task(self._run(job), name=f"network-monitor-{job.monitor_id}")
        self._jobs[job.monitor_id] = job
        return job

    async def stop(self, monitor_id: str) -> bool:
        job = self._jobs.get(monitor_id)
        if job is None:
            return False
        job.state = "stopped"
        if job.task and not job.task.done():
            job.task.cancel()
            await asyncio.gather(job.task, return_exceptions=True)
        return True

    async def _run(self, job: MonitorJob) -> None:
        try:
            while job.state == "running":
                measurement = await asyncio.to_thread(self._measure, job)
                job.last_measurement = measurement
                self._store.save_measurement(measurement)
                await asyncio.sleep(job.interval_seconds)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            job.state = "failed"
            job.error = str(error)

    def _measure(self, job: MonitorJob) -> dict[str, Any]:
        latencies = [_ping_once(job.target) for _ in range(job.pings_per_measurement)]
        successful = [latency for latency in latencies if latency is not None]
        jitter = statistics.pstdev(successful) if len(successful) > 1 else None
        download = upload = None
        if job.include_speed_test:
            download, upload = _speed_test()
        return {
            "monitor_id": job.monitor_id,
            "target": job.target,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "packets_sent": len(latencies),
            "packets_received": len(successful),
            "packet_loss_percent": round((1 - len(successful) / len(latencies)) * 100, 2),
            "latency_min_ms": min(successful) if successful else None,
            "latency_avg_ms": round(statistics.mean(successful), 2) if successful else None,
            "latency_max_ms": max(successful) if successful else None,
            "jitter_ms": round(jitter, 2) if jitter is not None else None,
            "download_mbps": download,
            "upload_mbps": upload,
        }
