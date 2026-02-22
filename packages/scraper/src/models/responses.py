"""Generic API response envelope model.

All API responses are wrapped in this envelope for consistency:
{ success: bool, data: T | None, error: str | None, meta: dict | None }
"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """JSON envelope for all API responses."""

    success: bool
    data: T | None = None
    error: str | None = None
    meta: dict | None = None
