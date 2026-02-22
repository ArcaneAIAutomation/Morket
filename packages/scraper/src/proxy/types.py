"""Proxy data models for the proxy manager."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProxyEndpoint:
    """Represents a single proxy endpoint with health and usage tracking."""

    url: str
    protocol: str  # http, https, socks5
    region: str | None = None
    is_healthy: bool = True
    success_count: int = 0
    failure_count: int = 0
    last_used_domains: dict[str, float] = field(default_factory=dict)
