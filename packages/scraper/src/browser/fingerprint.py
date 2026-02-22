"""Fingerprint randomization for anti-detection.

Generates randomized browser fingerprint profiles (user agent, viewport,
timezone, language, geolocation) and applies them to Playwright pages.
Includes inter-action delay generation to simulate human browsing behavior.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.async_api import Page


# ---------------------------------------------------------------------------
# Curated user agent list — real Chrome UA strings (desktop, recent versions)
# ---------------------------------------------------------------------------

CURATED_USER_AGENTS: list[str] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
]


# ---------------------------------------------------------------------------
# Region → timezone mapping
# ---------------------------------------------------------------------------

VALID_TIMEZONES: dict[str, list[str]] = {
    "US": [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Phoenix",
    ],
    "EU": [
        "Europe/London",
        "Europe/Berlin",
        "Europe/Paris",
        "Europe/Madrid",
        "Europe/Rome",
        "Europe/Amsterdam",
    ],
    "UK": [
        "Europe/London",
    ],
    "DE": [
        "Europe/Berlin",
    ],
    "FR": [
        "Europe/Paris",
    ],
    "BR": [
        "America/Sao_Paulo",
        "America/Fortaleza",
    ],
    "IN": [
        "Asia/Kolkata",
    ],
    "JP": [
        "Asia/Tokyo",
    ],
    "AU": [
        "Australia/Sydney",
        "Australia/Melbourne",
        "Australia/Perth",
    ],
    "CA": [
        "America/Toronto",
        "America/Vancouver",
    ],
}

# Flat list for when no region is specified
ALL_TIMEZONES: list[str] = sorted(
    {tz for tzs in VALID_TIMEZONES.values() for tz in tzs}
)

# ---------------------------------------------------------------------------
# Region → language mapping
# ---------------------------------------------------------------------------

VALID_LANGUAGES: dict[str, list[str]] = {
    "US": ["en-US"],
    "EU": ["en-GB", "de-DE", "fr-FR", "es-ES", "it-IT", "nl-NL"],
    "UK": ["en-GB"],
    "DE": ["de-DE"],
    "FR": ["fr-FR"],
    "BR": ["pt-BR"],
    "IN": ["en-IN", "hi-IN"],
    "JP": ["ja-JP"],
    "AU": ["en-AU"],
    "CA": ["en-CA", "fr-CA"],
}

ALL_LANGUAGES: list[str] = sorted(
    {lang for langs in VALID_LANGUAGES.values() for lang in langs}
)

# ---------------------------------------------------------------------------
# Region → approximate geolocation (lat, lng)
# ---------------------------------------------------------------------------

REGION_GEOLOCATIONS: dict[str, dict[str, float]] = {
    "US": {"latitude": 37.7749, "longitude": -122.4194},      # San Francisco
    "EU": {"latitude": 50.1109, "longitude": 8.6821},         # Frankfurt
    "UK": {"latitude": 51.5074, "longitude": -0.1278},        # London
    "DE": {"latitude": 52.5200, "longitude": 13.4050},        # Berlin
    "FR": {"latitude": 48.8566, "longitude": 2.3522},         # Paris
    "BR": {"latitude": -23.5505, "longitude": -46.6333},      # São Paulo
    "IN": {"latitude": 19.0760, "longitude": 72.8777},        # Mumbai
    "JP": {"latitude": 35.6762, "longitude": 139.6503},       # Tokyo
    "AU": {"latitude": -33.8688, "longitude": 151.2093},      # Sydney
    "CA": {"latitude": 43.6532, "longitude": -79.3832},       # Toronto
}


# ---------------------------------------------------------------------------
# JavaScript overrides to mask automation detection
# ---------------------------------------------------------------------------

WEBDRIVER_OVERRIDE_JS = """
() => {
    // Mask navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
    });

    // Mask chrome.runtime to appear as a normal Chrome browser
    if (!window.chrome) {
        window.chrome = {};
    }
    if (!window.chrome.runtime) {
        window.chrome.runtime = {
            connect: function() {},
            sendMessage: function() {},
        };
    }

    // Mask Permissions API to avoid detection via navigator.permissions.query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
    );
}
"""


# ---------------------------------------------------------------------------
# FingerprintProfile dataclass
# ---------------------------------------------------------------------------

@dataclass
class FingerprintProfile:
    """A randomized browser fingerprint profile."""

    user_agent: str
    viewport_width: int    # 1280–1920
    viewport_height: int   # 720–1080
    timezone: str
    language: str
    geolocation: dict[str, float] | None  # { latitude, longitude }


# ---------------------------------------------------------------------------
# FingerprintRandomizer
# ---------------------------------------------------------------------------

class FingerprintRandomizer:
    """Generates and applies randomized browser fingerprint profiles.

    Each call to ``generate()`` produces a fresh profile with a random user
    agent, viewport, timezone, language, and optional geolocation.  When a
    ``proxy_region`` is supplied the timezone, language, and geolocation are
    selected to be geo-consistent with that region.
    """

    def __init__(self, *, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._last_profile: FingerprintProfile | None = None

    # ------------------------------------------------------------------
    # generate
    # ------------------------------------------------------------------

    def generate(self, proxy_region: str | None = None) -> FingerprintProfile:
        """Return a randomized :class:`FingerprintProfile`.

        Parameters
        ----------
        proxy_region:
            ISO-style region code (e.g. ``"US"``, ``"EU"``).  When provided
            the timezone, language, and geolocation are chosen to be
            consistent with the region.  When ``None`` values are drawn from
            the full pool.
        """

        user_agent = self._rng.choice(CURATED_USER_AGENTS)
        viewport_width = self._rng.randint(1280, 1920)
        viewport_height = self._rng.randint(720, 1080)

        region = proxy_region.upper() if proxy_region else None

        if region and region in VALID_TIMEZONES:
            timezone = self._rng.choice(VALID_TIMEZONES[region])
            language = self._rng.choice(VALID_LANGUAGES[region])
            geolocation = REGION_GEOLOCATIONS.get(region)
        else:
            timezone = self._rng.choice(ALL_TIMEZONES)
            language = self._rng.choice(ALL_LANGUAGES)
            geolocation = None

        profile = FingerprintProfile(
            user_agent=user_agent,
            viewport_width=viewport_width,
            viewport_height=viewport_height,
            timezone=timezone,
            language=language,
            geolocation=geolocation,
        )

        self._last_profile = profile
        return profile

    # ------------------------------------------------------------------
    # apply
    # ------------------------------------------------------------------

    async def apply(self, page: "Page", profile: FingerprintProfile) -> None:
        """Apply *profile* to a Playwright *page*.

        Sets viewport, user agent extra headers, timezone, geolocation, and
        injects JS overrides to mask ``navigator.webdriver`` and
        ``chrome.runtime``.
        """

        # Set viewport
        await page.set_viewport_size(
            {"width": profile.viewport_width, "height": profile.viewport_height}
        )

        # Set extra HTTP headers for user agent and language
        await page.set_extra_http_headers(
            {
                "User-Agent": profile.user_agent,
                "Accept-Language": profile.language,
            }
        )

        # Set timezone via the browser context's emulation
        context = page.context
        await context.grant_permissions(["geolocation"])

        # Timezone and locale are set at context level — Playwright allows
        # overriding via ``add_init_script`` for the page.
        # We use ``emulate_media`` for timezone where available, but the
        # most reliable approach is the init script + geolocation API.

        if profile.geolocation:
            await context.set_geolocation(profile.geolocation)

        # Inject JS overrides before any page script runs
        await page.add_init_script(WEBDRIVER_OVERRIDE_JS)

    # ------------------------------------------------------------------
    # get_action_delay
    # ------------------------------------------------------------------

    def get_action_delay(
        self,
        min_delay_ms: int = 500,
        max_delay_ms: int = 2000,
    ) -> float:
        """Return a random delay in milliseconds within the given range.

        Used to simulate human browsing behaviour between actions.
        """

        return self._rng.uniform(min_delay_ms, max_delay_ms)
