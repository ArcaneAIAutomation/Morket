"""Configuration module — settings and domain policies."""

from src.config.domain_policies import AllowedHours, DomainPolicy, load_domain_policies
from src.config.settings import ScraperSettings

__all__ = [
    "AllowedHours",
    "DomainPolicy",
    "ScraperSettings",
    "load_domain_policies",
]
