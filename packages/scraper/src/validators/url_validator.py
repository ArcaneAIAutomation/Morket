"""URL validation for scrape targets — prevents SSRF attacks."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


# Private/reserved IP networks
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
]

_ALLOWED_SCHEMES = {"http", "https"}


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is in a private/reserved range."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in network for network in _PRIVATE_NETWORKS)
    except ValueError:
        return True  # Invalid IP → reject


async def validate_url(url: str) -> bool:
    """Validate a scrape target URL.

    Returns True if the URL is safe to scrape (valid scheme, public IP).
    Returns False if the URL uses a non-http/https scheme or resolves to a private IP.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in _ALLOWED_SCHEMES:
            return False
        if not parsed.hostname:
            return False

        # Resolve DNS
        infos = socket.getaddrinfo(parsed.hostname, None)
        for info in infos:
            ip = info[4][0]
            if is_private_ip(ip):
                return False
        return True
    except (socket.gaierror, ValueError, OSError):
        return False
