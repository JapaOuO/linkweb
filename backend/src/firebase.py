import json
from typing import Any

from .config import settings


class FirebaseStore:
    """Persists measurements when Firebase credentials are configured."""

    def __init__(self) -> None:
        self._collection = None
        if not settings.firebase_credentials_file and not settings.firebase_credentials_json:
            return

        import firebase_admin
        from firebase_admin import credentials, firestore

        if settings.firebase_credentials_file:
            credential = credentials.Certificate(settings.firebase_credentials_file)
        else:
            credential = credentials.Certificate(json.loads(settings.firebase_credentials_json or "{}"))

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credential)
        self._collection = firestore.client().collection("network_measurements")

    def save_measurement(self, measurement: dict[str, Any]) -> None:
        if self._collection is not None:
            self._collection.document(measurement["monitor_id"]).collection("measurements").add(measurement)

    def save_client_measurement(self, measurement: dict[str, Any]) -> None:
        if self._collection is not None:
            self._collection.document("browser-clients").collection("measurements").add(measurement)

    def list_client_measurements(self, limit: int = 500) -> list[dict[str, Any]]:
        if self._collection is None:
            return []
        documents = (
            self._collection.document("browser-clients")
            .collection("measurements")
            .order_by("timestamp", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [{"id": document.id, **document.to_dict()} for document in documents]

    def delete_client_measurement(self, measurement_id: str) -> None:
        if self._collection is not None:
            self._collection.document("browser-clients").collection("measurements").document(measurement_id).delete()

    def delete_all_client_measurements(self) -> None:
        if self._collection is None:
            return
        documents = self._collection.document("browser-clients").collection("measurements").stream()
        for document in documents:
            document.reference.delete()
