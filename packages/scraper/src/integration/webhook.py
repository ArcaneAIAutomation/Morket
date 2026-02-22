"""HMAC-SHA256 signed webhook callback delivery.

Delivers job completion notifications to callback URLs with retry logic
and exponential backoff. Payloads are signed for authenticity verification.

SECURITY: Signatures use HMAC-SHA256(secret, JSON payload).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

import httpx

logger = logging.getLogger(__name__)


class WebhookCallback:
    """Delivers HMAC-SHA256 signed webhook callbacks with retry logic.

    Parameters
    ----------
    webhook_secret:
        Shared secret for HMAC-SHA256 signature computation.
    default_url:
        Default callback URL (used when no override is provided).
    timeout_seconds:
        HTTP timeout per delivery attempt (default 10).
    max_retries:
        Maximum retry attempts (default 3).
    backoff_base:
        Base backoff in seconds (default 2). Schedule: 2s, 4s, 8s.
    """

    def __init__(
        self,
        webhook_secret: str,
        default_url: str | None = None,
        timeout_seconds: float = 10.0,
        max_retries: int = 3,
        backoff_base: float = 2.0,
    ) -> None:
        self._webhook_secret = webhook_secret
        self._default_url = default_url
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._backoff_base = backoff_base

    def compute_signature(self, payload_bytes: bytes) -> str:
        """Compute HMAC-SHA256 signature for a payload."""
        return hmac.new(
            self._webhook_secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).hexdigest()

    def build_payload(
        self,
        job_id: str,
        status: str,
        summary: dict,
        results: list[dict] | None = None,
        total_tasks: int = 0,
    ) -> dict:
        """Build webhook payload, including results only for jobs with ≤100 tasks."""
        payload: dict = {
            "job_id": job_id,
            "status": status,
            "summary": summary,
        }
        if results is not None and total_tasks <= 100:
            payload["results"] = results
        else:
            payload["results"] = None
        return payload

    async def deliver(
        self,
        url: str | None,
        job_id: str,
        status: str,
        results: list[dict] | None,
        summary: dict,
        total_tasks: int = 0,
    ) -> bool:
        """Deliver a signed webhook callback with retries.

        Parameters
        ----------
        url:
            Callback URL override. Falls back to default_url if None.
        job_id:
            The job identifier.
        status:
            Terminal job status (completed, partially_completed, failed, cancelled).
        results:
            List of task result dicts (included only if total_tasks ≤ 100).
        summary:
            Summary dict with total, completed, failed counts.
        total_tasks:
            Total number of tasks in the job (controls results inclusion).

        Returns
        -------
        bool
            True if delivery succeeded, False if all retries exhausted.
        """
        target_url = url or self._default_url
        if not target_url:
            logger.warning("No webhook URL configured for job %s, skipping delivery", job_id)
            return False

        payload = self.build_payload(job_id, status, summary, results, total_tasks)
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        signature = self.compute_signature(payload_bytes)

        last_exception: Exception | None = None

        for attempt in range(self._max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        target_url,
                        content=payload_bytes,
                        headers={
                            "Content-Type": "application/json",
                            "X-Webhook-Signature": signature,
                        },
                        timeout=self._timeout_seconds,
                    )

                if response.status_code < 400:
                    logger.info(
                        "Webhook delivered for job %s to %s (status %d)",
                        job_id,
                        target_url,
                        response.status_code,
                    )
                    return True

                last_exception = httpx.HTTPStatusError(
                    f"Webhook delivery returned {response.status_code}",
                    request=response.request,
                    response=response,
                )

            except (httpx.ConnectError, httpx.TimeoutException, httpx.ConnectTimeout) as exc:
                last_exception = exc

            except httpx.HTTPStatusError as exc:
                last_exception = exc

            backoff = self._backoff_base * (2**attempt)  # 2s, 4s, 8s
            logger.warning(
                "Webhook delivery failed for job %s (attempt %d/%d), retrying in %.0fs",
                job_id,
                attempt + 1,
                self._max_retries,
                backoff,
            )
            if attempt < self._max_retries - 1:
                import asyncio
                await asyncio.sleep(backoff)

        logger.error(
            "Webhook delivery failed for job %s after %d attempts: %s",
            job_id,
            self._max_retries,
            last_exception,
        )
        return False
