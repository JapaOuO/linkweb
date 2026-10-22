from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class MonitorCreateRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=253, description="IP ou hostname do aparelho")
    interval_seconds: float = Field(default=60, ge=1, le=3600)
    pings_per_measurement: int = Field(default=4, ge=1, le=20)
    include_speed_test: bool = False

    @field_validator("target")
    @classmethod
    def normalize_target(cls, value: str) -> str:
        target = value.strip()
        if any(character.isspace() for character in target):
            raise ValueError("target deve ser um único IP ou hostname")
        return target


class MonitorStatus(BaseModel):
    monitor_id: str
    target: str
    interval_seconds: float
    pings_per_measurement: int
    include_speed_test: bool
    state: Literal["running", "stopped", "failed"]
    last_measurement: dict | None = None
    error: str | None = None


class Measurement(BaseModel):
    monitor_id: str
    target: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    packets_sent: int
    packets_received: int
    packet_loss_percent: float
    latency_min_ms: float | None
    latency_avg_ms: float | None
    latency_max_ms: float | None
    jitter_ms: float | None
    download_mbps: float | None = None
    upload_mbps: float | None = None


class ClientMeasurement(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=100)
    device_type: Literal["tablet", "notebook", "desktop"] = "notebook"
    connection_type: Literal["wifi", "cabled", "unknown"] = "unknown"
    latency_target: str = Field(default="Google", max_length=100)
    latency_target_url: str = Field(default="https://www.google.com/generate_204", max_length=500)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    samples_sent: int = Field(..., ge=0, le=100)
    samples_received: int = Field(..., ge=0, le=100)
    latency_min_ms: float | None = Field(default=None, ge=0)
    latency_avg_ms: float | None = Field(default=None, ge=0)
    latency_max_ms: float | None = Field(default=None, ge=0)
    jitter_ms: float | None = Field(default=None, ge=0)
    download_mbps: float | None = Field(default=None, ge=0)
    upload_mbps: float | None = Field(default=None, ge=0)
