from __future__ import annotations

import json
import logging
import sys
from typing import Any

# Fields a log call may pass via `extra={...}` that we want surfaced as their
# own JSON keys rather than folded into the free-text message. Kept narrow and
# job-focused per Milestone 7 scope (no general request-logging rework here).
_STRUCTURED_FIELDS = (
    "task_name",
    "task_id",
    "idempotency_key",
    "retries",
    "duration_s",
    "result",
    "error",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in _STRUCTURED_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Install a single JSON stdout handler on the root logger.

    Idempotent: calling it more than once (Celery fires its `setup_logging`
    signal per worker process) replaces rather than stacks handlers.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
