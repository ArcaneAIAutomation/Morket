"""Proxy management package — rotation, health checks, and per-domain cooldown."""

from src.proxy.manager import ProxyManager
from src.proxy.types import ProxyEndpoint

__all__ = ["ProxyEndpoint", "ProxyManager"]
