"""Property tests for structured logging.

# Feature: scraping-microservices, Property 38: Structured log format
# Feature: scraping-microservices, Property 39: No credentials in logs or metrics
"""

from __future__ import annotations

import json
import logging

from hypothesis import given, settings, strategies as st

from src.logging_config import JsonFormatter


# --- Strategies ---

request_ids = st.uuids().map(str)
messages = st.text(min_size=1, max_size=100, alphabet="abcdefghijklmnopqrstuvwxyz0123456789 ._-/")
levels = st.sampled_from(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
target_urls = st.from_regex(r"https://[a-z]{3,10}\.[a-z]{2,4}/[a-z0-9]{1,10}", fullmatch=True)
domains = st.from_regex(r"[a-z]{3,10}\.[a-z]{2,4}", fullmatch=True)
durations = st.floats(min_value=0.1, max_value=60000.0, allow_nan=False, allow_infinity=False)
field_counts = st.integers(min_value=0, max_value=20)


def _make_record(
    message: str,
    level: str = "INFO",
    request_id: str | None = None,
    **extra: object,
) -> logging.LogRecord:
    """Create a LogRecord with optional extra attributes."""
    record = logging.LogRecord(
        name="test",
        level=getattr(logging, level),
        pathname="test.py",
        lineno=1,
        msg=message,
        args=(),
        exc_info=None,
    )
    if request_id is not None:
        record.request_id = request_id  # type: ignore[attr-defined]
    for key, value in extra.items():
        setattr(record, key, value)
    return record


# --- Property 38: Structured log format ---

@settings(max_examples=100)
@given(
    message=messages,
    level=levels,
    request_id=request_ids,
)
def test_structured_log_format_basic(
    message: str,
    level: str,
    request_id: str,
) -> None:
    """Property 38: Structured log format — basic fields.

    For any log entry emitted by the service, the entry SHALL be valid JSON
    containing at minimum a request_id, level, and timestamp field.
    """
    # Feature: scraping-microservices, Property 38: Structured log format

    formatter = JsonFormatter()
    record = _make_record(message, level=level, request_id=request_id)
    output = formatter.format(record)

    # Must be valid JSON
    parsed = json.loads(output)

    # Required fields
    assert "timestamp" in parsed
    assert "level" in parsed
    assert "request_id" in parsed
    assert parsed["level"] == level
    assert parsed["request_id"] == request_id


@settings(max_examples=100)
@given(
    message=messages,
    request_id=request_ids,
    target_url=target_urls,
    proxy_used=st.text(min_size=5, max_size=30, alphabet="abcdefghijklmnopqrstuvwxyz0123456789.:/_-"),
    error_reason=messages,
)
def test_structured_log_format_failed_task(
    message: str,
    request_id: str,
    target_url: str,
    proxy_used: str,
    error_reason: str,
) -> None:
    """Property 38: Structured log format — failed task fields.

    For failed tasks, the entry SHALL additionally contain target_url,
    proxy_used, and error_reason.
    """
    # Feature: scraping-microservices, Property 38: Structured log format

    formatter = JsonFormatter()
    record = _make_record(
        message,
        level="ERROR",
        request_id=request_id,
        target_url=target_url,
        proxy_used=proxy_used,
        error_reason=error_reason,
    )
    output = formatter.format(record)
    parsed = json.loads(output)

    assert parsed["target_url"] == target_url
    assert parsed["proxy_used"] == proxy_used
    assert "error_reason" in parsed


@settings(max_examples=100)
@given(
    message=messages,
    request_id=request_ids,
    target_domain=domains,
    duration_ms=durations,
    fields_extracted=field_counts,
)
def test_structured_log_format_completed_task(
    message: str,
    request_id: str,
    target_domain: str,
    duration_ms: float,
    fields_extracted: int,
) -> None:
    """Property 38: Structured log format — completed task fields.

    For completed tasks, the entry SHALL contain target_domain, duration_ms,
    and fields_extracted.
    """
    # Feature: scraping-microservices, Property 38: Structured log format

    formatter = JsonFormatter()
    record = _make_record(
        message,
        level="INFO",
        request_id=request_id,
        target_domain=target_domain,
        duration_ms=duration_ms,
        fields_extracted=fields_extracted,
    )
    output = formatter.format(record)
    parsed = json.loads(output)

    assert parsed["target_domain"] == target_domain
    assert parsed["duration_ms"] == duration_ms
    assert parsed["fields_extracted"] == fields_extracted


# --- Property 39: No credentials in logs or metrics ---

@settings(max_examples=100)
@given(
    secret_value=st.text(min_size=8, max_size=32, alphabet="abcdefghijklmnopqrstuvwxyz0123456789"),
    prefix=st.sampled_from([
        "service_key=",
        "api_key=",
        "secret=",
        "password=",
        "token=",
        "credential=",
        "authorization: ",
        "Service-Key: ",
    ]),
)
def test_no_credentials_in_logs(
    secret_value: str,
    prefix: str,
) -> None:
    """Property 39: No credentials in logs or metrics.

    For any log entry or metrics output, the content SHALL NOT contain
    decrypted credential values, authentication tokens, or PII.
    """
    # Feature: scraping-microservices, Property 39: No credentials in logs or metrics

    formatter = JsonFormatter()

    # Embed a credential-like value in the message
    tainted_message = f"Request failed with {prefix}{secret_value} in header"
    record = _make_record(tainted_message, level="ERROR", request_id="test-id")
    output = formatter.format(record)
    parsed = json.loads(output)

    # The raw secret value should be redacted from the message
    assert secret_value not in parsed["message"], (
        f"Secret value '{secret_value}' found in log message"
    )
