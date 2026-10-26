import json
from typing import Any

from .config import settings


class FirebaseStoreError(RuntimeError):
    """Raised when Firebase persistence is unavailable."""


class FirebaseStore:
    """Persists measurements in Firestore."""

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
        self._require_collection().document(measurement["monitor_id"]).collection("measurements").add(measurement)

    def save_client_measurement(self, measurement: dict[str, Any]) -> None:
        self._require_collection().document("browser-clients").collection("measurements").document(
            measurement["id"]
        ).set(measurement)

    def list_client_measurements(self, limit: int = 500) -> list[dict[str, Any]]:
        collection = self._require_collection()
        documents = (
            collection.document("browser-clients")
            .collection("measurements")
            .limit(limit)
            .stream()
        )
        measurements = [{"id": document.id, **document.to_dict()} for document in documents]
        measurements.sort(key=lambda item: str(item.get("timestamp", "")), reverse=True)
        return measurements[:limit]

    def delete_client_measurement(self, measurement_id: str) -> None:
        self._require_collection().document("browser-clients").collection("measurements").document(measurement_id).delete()

    def delete_all_client_measurements(self) -> None:
        documents = self._require_collection().document("browser-clients").collection("measurements").stream()
        for document in documents:
            document.reference.delete()

    def _require_collection(self):
        if self._collection is None:
            raise FirebaseStoreError(
                "Firebase não está configurado. Defina FIREBASE_CREDENTIALS_FILE ou FIREBASE_CREDENTIALS_JSON."
            )
        return self._collection
