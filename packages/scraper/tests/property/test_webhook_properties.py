"""Property tests for webhook callback delivery.

# Feature: scraping-microservices, Property 40: HMAC-SHA256 webhook signature correctness
# Feature: scraping-microservices, Property 41: Webhook payload size by job task count
# Feature: scraping-microservices, Property 42: Webhook callback URL override
# Feature: scraping-microservices, Property 43: Terminal job state triggers webhook
"""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from hypothesis import given, settings, strategies as st

from src.integration.webhook import WebhookCallback


# --- Strategies ---

job_ids = st.uuids().map(str)
secrets = st.text(min_size=8, max_size=64, alphabet="abcdefghijklmnopqrstuvwxyz0123456789")
terminal_statuses = st.sampled_from(["completed", "partially_completed", "failed", "cancelled"])

summaries = st.fixed_dictionaries({
    "total": st.integers(min_value=1, max_value=200),
    "completed": st.integers(min_value=0, max_value=200),
    "failed": st.integers(min_value=0, max_value=200),
})

result_items = st.fixed_dictionaries({
    "task_id": st.uuids().map(str),
    "status": st.just("completed"),
    "data": st.fixed_dictionaries({
        "name": st.text(min_size=1, max_size=20, alphabet="abcdefghijklmnopqrstuvwxyz "),
    }),
})


# --- Property 40: HMAC-SHA256 webhook signature correctness ---

@settings(max_examples=100)
@given(
    secret=secrets,
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
)
def test_hmac_signature_correctness(
    secret: str,
    job_id: str,
    status: str,
    summary: dict,
) -> None:
    """Property 40: HMAC-SHA256 webhook signature correctness.

    For any webhook payload and shared secret, the X-Webhook-Signature header
    SHALL contain a valid HMAC-SHA256 signature that can be verified by
    recomputing HMAC-SHA256(secret, JSON payload).
    """
    # Feature: scraping-microservices, Property 40: HMAC-SHA256 webhook signature correctness

    callback = WebhookCallback(webhook_secret=secret)

    payload = callback.build_payload(job_id, status, summary, results=None, total_tasks=0)
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")

    signature = callback.compute_signature(payload_bytes)

    # Independently recompute
    expected = hmac.new(
        secret.encode("utf-8"),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()

    assert signature == expected
    # Verify it's a valid hex string of correct length (SHA-256 = 64 hex chars)
    assert len(signature) == 64
    assert all(c in "0123456789abcdef" for c in signature)


# --- Property 41: Webhook payload size by job task count ---

@settings(max_examples=100)
@given(
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
    results=st.lists(result_items, min_size=1, max_size=5),
    total_tasks=st.integers(min_value=1, max_value=100),
)
def test_payload_includes_results_for_small_jobs(
    job_id: str,
    status: str,
    summary: dict,
    results: list[dict],
    total_tasks: int,
) -> None:
    """Property 41: Webhook payload size by job task count (≤100 tasks).

    For any completed job with ≤100 tasks, the webhook payload SHALL include
    the full array of task results.
    """
    # Feature: scraping-microservices, Property 41: Webhook payload size by job task count

    callback = WebhookCallback(webhook_secret="test-secret")
    payload = callback.build_payload(job_id, status, summary, results=results, total_tasks=total_tasks)

    assert payload["results"] == results
    assert payload["job_id"] == job_id
    assert payload["status"] == status


@settings(max_examples=100)
@given(
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
    results=st.lists(result_items, min_size=1, max_size=5),
    total_tasks=st.integers(min_value=101, max_value=500),
)
def test_payload_excludes_results_for_large_jobs(
    job_id: str,
    status: str,
    summary: dict,
    results: list[dict],
    total_tasks: int,
) -> None:
    """Property 41: Webhook payload size by job task count (>100 tasks).

    For any completed job with >100 tasks, the webhook payload SHALL include
    only the job summary without individual results.
    """
    # Feature: scraping-microservices, Property 41: Webhook payload size by job task count

    callback = WebhookCallback(webhook_secret="test-secret")
    payload = callback.build_payload(job_id, status, summary, results=results, total_tasks=total_tasks)

    assert payload["results"] is None
    assert payload["job_id"] == job_id
    assert payload["status"] == status
    assert payload["summary"] == summary


# --- Property 42: Webhook callback URL override ---

@settings(max_examples=100)
@given(
    default_url=st.just("https://default.example.com/webhook"),
    override_url=st.from_regex(r"https://[a-z]+\.example\.com/callback", fullmatch=True),
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
)
@pytest.mark.asyncio
async def test_callback_url_override(
    default_url: str,
    override_url: str,
    job_id: str,
    status: str,
    summary: dict,
) -> None:
    """Property 42: Webhook callback URL override.

    For any scrape request that includes a callback_url field, the webhook
    callback SHALL be delivered to that URL instead of the default.
    """
    # Feature: scraping-microservices, Property 42: Webhook callback URL override

    callback = WebhookCallback(webhook_secret="test-secret", default_url=default_url)

    mock_response = httpx.Response(200, request=httpx.Request("POST", override_url))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
        result = await callback.deliver(
            url=override_url,
            job_id=job_id,
            status=status,
            results=None,
            summary=summary,
            total_tasks=0,
        )

        assert result is True
        # Verify the override URL was used, not the default
        call_args = mock_post.call_args
        assert call_args[0][0] == override_url


@settings(max_examples=100)
@given(
    default_url=st.just("https://default.example.com/webhook"),
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
)
@pytest.mark.asyncio
async def test_callback_uses_default_when_no_override(
    default_url: str,
    job_id: str,
    status: str,
    summary: dict,
) -> None:
    """Property 42: Webhook callback URL override — falls back to default.

    When no override URL is provided, the default URL SHALL be used.
    """
    # Feature: scraping-microservices, Property 42: Webhook callback URL override

    callback = WebhookCallback(webhook_secret="test-secret", default_url=default_url)

    mock_response = httpx.Response(200, request=httpx.Request("POST", default_url))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
        result = await callback.deliver(
            url=None,
            job_id=job_id,
            status=status,
            results=None,
            summary=summary,
            total_tasks=0,
        )

        assert result is True
        call_args = mock_post.call_args
        assert call_args[0][0] == default_url


# --- Property 43: Terminal job state triggers webhook ---

@settings(max_examples=100)
@given(
    job_id=job_ids,
    status=terminal_statuses,
    summary=summaries,
)
@pytest.mark.asyncio
async def test_terminal_state_triggers_webhook(
    job_id: str,
    status: str,
    summary: dict,
) -> None:
    """Property 43: Terminal job state triggers webhook.

    For any job that reaches a terminal state (completed, partially_completed,
    failed, cancelled), the service SHALL deliver a webhook callback containing
    the job ID, final status, and result summary.
    """
    # Feature: scraping-microservices, Property 43: Terminal job state triggers webhook

    url = "https://example.com/webhook"
    callback = WebhookCallback(webhook_secret="test-secret", default_url=url)

    mock_response = httpx.Response(200, request=httpx.Request("POST", url))
    delivered_payloads: list[bytes] = []

    async def capture_post(post_url, *, content, headers, timeout):
        delivered_payloads.append(content)
        return mock_response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=capture_post):
        result = await callback.deliver(
            url=None,
            job_id=job_id,
            status=status,
            results=None,
            summary=summary,
            total_tasks=0,
        )

        assert result is True
        assert len(delivered_payloads) == 1

        payload = json.loads(delivered_payloads[0])
        assert payload["job_id"] == job_id
        assert payload["status"] == status
        assert payload["summary"] == summary
