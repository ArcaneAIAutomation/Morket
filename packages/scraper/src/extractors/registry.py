"""Pluggable extractor registry.

Maps ``TargetType`` → ``BaseExtractor`` instance.  Adding a new target type
requires only creating an extractor subclass and calling ``register()`` —
no existing extractor code needs modification (open/closed principle).
"""

from __future__ import annotations

import logging

from src.extractors.base import BaseExtractor
from src.models.requests import TargetType

logger = logging.getLogger(__name__)


class ExtractorRegistry:
    """Registry that maps target types to their extractor implementations."""

    def __init__(self) -> None:
        self._extractors: dict[TargetType, BaseExtractor] = {}

    def register(self, extractor: BaseExtractor) -> None:
        """Register an extractor for its declared ``target_type``.

        Raises
        ------
        ValueError
            If an extractor for the same target type is already registered.
        """
        target_type = extractor.target_type
        if target_type in self._extractors:
            raise ValueError(
                f"Extractor for target type '{target_type.value}' is already registered"
            )
        self._extractors[target_type] = extractor
        logger.info("Registered extractor for target type '%s'", target_type.value)

    def get(self, target_type: TargetType) -> BaseExtractor:
        """Return the extractor for *target_type*.

        Raises
        ------
        KeyError
            If no extractor is registered for the given target type.
        """
        try:
            return self._extractors[target_type]
        except KeyError:
            raise KeyError(
                f"No extractor registered for target type '{target_type.value}'"
            ) from None

    def list_types(self) -> list[TargetType]:
        """Return a list of all registered target types."""
        return list(self._extractors.keys())
