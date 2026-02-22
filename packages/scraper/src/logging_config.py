"""Structured JSON logging configuration.

Configures Python logging to emit JSON-formatted log entries with required
fields: request_id, level, timestamp. Task-specific fields are added
contextually (target_url, proxy_used, error_reason for failures;
target_domain, duration_ms, fields_extracted for completions).

SECURITY: Never logs credential values, auth tokens, or PII.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone


# Patterns that should be redacted from log output
_SENSITIVE_PATTERNS = re.compile(
    r"(service.key|api.key|secret|password|token|credential|authorization)"
    r"[\s]*[=:]\s*\S+",
    re.IGNORECASE,
)


class JsonFormatter(logging.Formatter):
    """Formats log records as JSON with structured fields.

    Each entry contains at minimum: request_id, level, timestamp, message.
    Additional fields can be attached via the ``extra`` dict on log calls.
    """

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": self._sanitize(record.getMessage()),
            "request_id": getattr(record, "request_id", None),
        }

        # Task failure fields
        if hasattr(record, "target_url"):
            entry["target_url"] = getattr(record, "target_url")
        if hasattr(record, "proxy_used"):
            entry["proxy_used"] = getattr(record, "proxy_used")
        if hasattr(record, "error_reason"):
            entry["error_reason"] = self._sanitize(
                str(getattr(record, "error_reason"))
            )
        if hasattr(record, "retry_attempts"):
            entry["retry_attempts"] = getattr(record, "retry_attempts")

        # Task completion fields
        if hasattr(record, "target_domain"):
            entry["target_domain"] = getattr(record, "target_domain")
        if hasattr(record, "duration_ms"):
            entry["duration_ms"] = getattr(record, "duration_ms")
        if hasattr(record, "fields_extracted"):
            entry["fields_extracted"] = getattr(record, "fields_extracted")
        if hasattr(record, "result_completeness"):
            entry["result_completeness"] = getattr(record, "result_completeness")

        # Exception info
        if record.exc_info and record.exc_info[1]:
            entry["exception"] = self._sanitize(
                self.formatException(record.exc_info)
            )

        return json.dumps(entry, default=str)

    @staticmethod
    def _sanitize(text: str) -> str:
        """Remove sensitive values from log text."""
        return _SENSITIVE_PATTERNS.sub("[REDACTED]", text)


def configure_logging(level: str = "INFO") -> None:
    """Configure the root logger with JSON formatting.

    Parameters
    ----------
    level:
        Log level string (DEBUG, INFO, WARNING, ERROR, CRITICAL).
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicates
    root.handlers.clear()

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
