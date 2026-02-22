"""Middleware package — error hierarchy, auth, and request ID."""

from src.middleware.auth import ServiceKeyAuthMiddleware
from src.middleware.error_handler import (
    AuthenticationError,
    CircuitOpenError,
    CredentialNotFoundError,
    JobNotFoundError,
    NoHealthyProxiesError,
    PoolExhaustedError,
    QueueFullError,
    ScraperError,
    TaskNotFoundError,
    TaskTimeoutError,
    ValidationError,
    register_error_handlers,
)
from src.middleware.request_id import RequestIdMiddleware

__all__ = [
    "AuthenticationError",
    "CircuitOpenError",
    "CredentialNotFoundError",
    "JobNotFoundError",
    "NoHealthyProxiesError",
    "PoolExhaustedError",
    "QueueFullError",
    "RequestIdMiddleware",
    "ScraperError",
    "ServiceKeyAuthMiddleware",
    "TaskNotFoundError",
    "TaskTimeoutError",
    "ValidationError",
    "register_error_handlers",
]
