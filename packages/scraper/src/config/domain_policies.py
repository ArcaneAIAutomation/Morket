"""Domain policy models and YAML loader.

Provides typed Pydantic models for per-domain scraping policies
and a loader function that parses the YAML config into those models.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AllowedHours(BaseModel):
    """UTC hour window during which scraping is permitted."""

    start: int = Field(ge=0, le=23)
    end: int = Field(ge=0, le=23)


class DomainPolicy(BaseModel):
    """Rate limiting and politeness policy for a single domain."""

    tokens_per_interval: int = Field(default=2, ge=1)
    interval_seconds: int = Field(default=10, ge=1)
    min_delay_ms: int = Field(default=500, ge=0)
    max_delay_ms: int = Field(default=2000, ge=0)
    allowed_hours: AllowedHours | None = None
    respect_robots_txt: bool = False


_DEFAULT_POLICY = DomainPolicy()


def load_domain_policies(yaml_path: str) -> dict[str, DomainPolicy]:
    """Parse a domain policies YAML file into typed DomainPolicy objects.

    Args:
        yaml_path: Path to the YAML configuration file.

    Returns:
        A dict mapping domain names (and "default") to DomainPolicy instances.
        If the file is not found, returns just the built-in default policy.
    """
    path = Path(yaml_path)

    if not path.exists():
        logger.warning("Domain policies file not found at %s — using built-in defaults", yaml_path)
        return {"default": _DEFAULT_POLICY}

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        logger.error("Failed to parse domain policies YAML at %s: %s", yaml_path, exc)
        return {"default": _DEFAULT_POLICY}

    if not isinstance(raw, dict) or "domains" not in raw:
        logger.warning("Domain policies YAML missing 'domains' key — using built-in defaults")
        return {"default": _DEFAULT_POLICY}

    policies: dict[str, DomainPolicy] = {}
    for domain, config in raw["domains"].items():
        try:
            policies[domain] = DomainPolicy.model_validate(config)
        except Exception as exc:
            logger.error("Invalid policy for domain '%s': %s — skipping", domain, exc)

    # Ensure a default policy always exists
    if "default" not in policies:
        policies["default"] = _DEFAULT_POLICY

    return policies
