"""Property tests for browser pool recycling.

Validates that browser instances are correctly identified for recycling
when their pages_processed count meets or exceeds the configured page limit.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from src.browser.pool import BrowserInstance


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Page limits: positive integers (a pool would never use 0 or negative)
page_limits = st.integers(min_value=1, max_value=10_000)

# Pages processed: non-negative integers
pages_processed_counts = st.integers(min_value=0, max_value=10_000)


# ---------------------------------------------------------------------------
# Property 12: Browser instance recycling after page threshold
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(pages_processed=pages_processed_counts, page_limit=page_limits)
def test_browser_instance_recycling_after_page_threshold(
    pages_processed: int,
    page_limit: int,
) -> None:
    # Feature: scraping-microservices, Property 12: Browser instance recycling after page threshold
    # **Validates: Requirements 4.7**

    instance = BrowserInstance(
        id="test-instance",
        browser=None,
        pages_processed=pages_processed,
    )

    result = instance.needs_recycling(page_limit)

    # needs_recycling must return True iff pages_processed >= page_limit
    expected = pages_processed >= page_limit
    assert result == expected, (
        f"needs_recycling({page_limit}) returned {result} "
        f"but pages_processed={pages_processed} {'>='}  page_limit={page_limit} "
        f"→ expected {expected}"
    )
