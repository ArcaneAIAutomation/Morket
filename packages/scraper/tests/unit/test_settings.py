"""Unit tests for ScraperSettings and domain policy loading."""

import os
import tempfile
from pathlib import Path

import pytest
import yaml

from src.config.settings import ScraperSettings
from src.config.domain_policies import AllowedHours, DomainPolicy, load_domain_policies


# ---------------------------------------------------------------------------
# ScraperSettings
# ---------------------------------------------------------------------------

_REQUIRED_ENV = {
    "SCRAPER_SERVICE_KEY": "test-key",
    "SCRAPER_BACKEND_API_URL": "https://api.morket.io/api/v1",
    "SCRAPER_BACKEND_SERVICE_KEY": "backend-key",
    "SCRAPER_WEBHOOK_SECRET": "webhook-secret",
}


class TestScraperSettings:
    def test_loads_with_required_env_vars(self, monkeypatch: pytest.MonkeyPatch):
        for k, v in _REQUIRED_ENV.items():
            monkeypatch.setenv(k, v)

        settings = ScraperSettings()

        assert settings.service_key == "test-key"
        assert settings.backend_api_url == "https://api.morket.io/api/v1"
        assert settings.backend_service_key == "backend-key"
        assert settings.webhook_secret == "webhook-secret"

    def test_defaults_are_correct(self, monkeypatch: pytest.MonkeyPatch):
        for k, v in _REQUIRED_ENV.items():
            monkeypatch.setenv(k, v)

        settings = ScraperSettings()

        assert settings.port == 8001
        assert settings.log_level == "INFO"
        assert settings.browser_pool_size == 5
        assert settings.browser_pool_max == 20
        assert settings.browser_page_limit == 100
        assert settings.navigation_timeout_ms == 30000
        assert settings.max_queue_depth == 500
        assert settings.task_timeout_seconds == 60
        assert settings.rate_limit_tokens == 2
        assert settings.rate_limit_interval_seconds == 10
        assert settings.cb_window_size == 10
        assert settings.cb_failure_threshold == 5
        assert settings.cb_cooldown_seconds == 120
        assert settings.proxy_endpoints == []
        assert settings.proxy_health_check_interval_seconds == 60
        assert settings.proxy_domain_cooldown_seconds == 30
        assert settings.credential_cache_ttl_seconds == 300
        assert settings.credential_max_retries == 3
        assert settings.graceful_shutdown_seconds == 30
        assert settings.domain_policies_path == "src/config/domain_policies.yaml"
        assert settings.default_webhook_url is None

    def test_env_prefix_is_scraper(self, monkeypatch: pytest.MonkeyPatch):
        for k, v in _REQUIRED_ENV.items():
            monkeypatch.setenv(k, v)
        monkeypatch.setenv("SCRAPER_PORT", "9000")

        settings = ScraperSettings()
        assert settings.port == 9000

    def test_missing_required_field_raises(self, monkeypatch: pytest.MonkeyPatch):
        # Clear any existing env vars that might satisfy requirements
        for k in _REQUIRED_ENV:
            monkeypatch.delenv(k, raising=False)

        with pytest.raises(Exception):
            ScraperSettings()

    def test_proxy_endpoints_from_env(self, monkeypatch: pytest.MonkeyPatch):
        for k, v in _REQUIRED_ENV.items():
            monkeypatch.setenv(k, v)
        monkeypatch.setenv(
            "SCRAPER_PROXY_ENDPOINTS", '["http://proxy1:8080","socks5://proxy2:1080"]'
        )

        settings = ScraperSettings()
        assert settings.proxy_endpoints == ["http://proxy1:8080", "socks5://proxy2:1080"]

    def test_browser_pool_size_validation(self, monkeypatch: pytest.MonkeyPatch):
        for k, v in _REQUIRED_ENV.items():
            monkeypatch.setenv(k, v)
        monkeypatch.setenv("SCRAPER_BROWSER_POOL_SIZE", "0")

        with pytest.raises(Exception):
            ScraperSettings()


# ---------------------------------------------------------------------------
# DomainPolicy model
# ---------------------------------------------------------------------------


class TestDomainPolicy:
    def test_default_values(self):
        policy = DomainPolicy()
        assert policy.tokens_per_interval == 2
        assert policy.interval_seconds == 10
        assert policy.min_delay_ms == 500
        assert policy.max_delay_ms == 2000
        assert policy.allowed_hours is None
        assert policy.respect_robots_txt is False

    def test_with_allowed_hours(self):
        policy = DomainPolicy(
            tokens_per_interval=1,
            interval_seconds=15,
            allowed_hours=AllowedHours(start=6, end=22),
            respect_robots_txt=True,
        )
        assert policy.allowed_hours is not None
        assert policy.allowed_hours.start == 6
        assert policy.allowed_hours.end == 22

    def test_allowed_hours_validation(self):
        with pytest.raises(Exception):
            AllowedHours(start=-1, end=22)
        with pytest.raises(Exception):
            AllowedHours(start=6, end=25)


# ---------------------------------------------------------------------------
# load_domain_policies
# ---------------------------------------------------------------------------


class TestLoadDomainPolicies:
    def test_loads_valid_yaml(self, tmp_path: Path):
        yaml_content = {
            "domains": {
                "example.com": {
                    "tokens_per_interval": 3,
                    "interval_seconds": 20,
                    "min_delay_ms": 1000,
                    "max_delay_ms": 3000,
                    "respect_robots_txt": True,
                },
                "default": {
                    "tokens_per_interval": 2,
                    "interval_seconds": 10,
                    "min_delay_ms": 500,
                    "max_delay_ms": 2000,
                    "respect_robots_txt": False,
                },
            }
        }
        yaml_file = tmp_path / "policies.yaml"
        yaml_file.write_text(yaml.dump(yaml_content))

        policies = load_domain_policies(str(yaml_file))

        assert "example.com" in policies
        assert "default" in policies
        assert policies["example.com"].tokens_per_interval == 3
        assert policies["example.com"].respect_robots_txt is True
        assert policies["default"].tokens_per_interval == 2

    def test_file_not_found_returns_default(self):
        policies = load_domain_policies("/nonexistent/path/policies.yaml")

        assert "default" in policies
        assert len(policies) == 1
        assert policies["default"].tokens_per_interval == 2

    def test_loads_bundled_yaml(self):
        """Load the actual domain_policies.yaml shipped with the project."""
        policies = load_domain_policies("src/config/domain_policies.yaml")

        assert "linkedin.com" in policies
        assert "indeed.com" in policies
        assert "default" in policies
        assert policies["linkedin.com"].tokens_per_interval == 1
        assert policies["linkedin.com"].interval_seconds == 15
        assert policies["linkedin.com"].allowed_hours is not None
        assert policies["linkedin.com"].allowed_hours.start == 6
        assert policies["linkedin.com"].respect_robots_txt is True
        assert policies["indeed.com"].tokens_per_interval == 2
        assert policies["indeed.com"].respect_robots_txt is True
        assert policies["default"].respect_robots_txt is False

    def test_missing_domains_key_returns_default(self, tmp_path: Path):
        yaml_file = tmp_path / "bad.yaml"
        yaml_file.write_text("some_other_key: value\n")

        policies = load_domain_policies(str(yaml_file))

        assert "default" in policies
        assert len(policies) == 1

    def test_invalid_yaml_returns_default(self, tmp_path: Path):
        yaml_file = tmp_path / "broken.yaml"
        yaml_file.write_text(": : : not valid yaml [[[")

        policies = load_domain_policies(str(yaml_file))

        assert "default" in policies
        assert len(policies) == 1

    def test_skips_invalid_domain_entry(self, tmp_path: Path):
        yaml_content = {
            "domains": {
                "good.com": {
                    "tokens_per_interval": 5,
                    "interval_seconds": 10,
                },
                "bad.com": {
                    "tokens_per_interval": -1,  # invalid: ge=1
                },
                "default": {
                    "tokens_per_interval": 2,
                    "interval_seconds": 10,
                },
            }
        }
        yaml_file = tmp_path / "policies.yaml"
        yaml_file.write_text(yaml.dump(yaml_content))

        policies = load_domain_policies(str(yaml_file))

        assert "good.com" in policies
        assert "bad.com" not in policies
        assert "default" in policies

    def test_adds_default_if_missing_from_yaml(self, tmp_path: Path):
        yaml_content = {
            "domains": {
                "example.com": {
                    "tokens_per_interval": 3,
                    "interval_seconds": 20,
                }
            }
        }
        yaml_file = tmp_path / "policies.yaml"
        yaml_file.write_text(yaml.dump(yaml_content))

        policies = load_domain_policies(str(yaml_file))

        assert "example.com" in policies
        assert "default" in policies  # auto-added

    def test_with_allowed_hours_in_yaml(self, tmp_path: Path):
        yaml_content = {
            "domains": {
                "linkedin.com": {
                    "tokens_per_interval": 1,
                    "interval_seconds": 15,
                    "min_delay_ms": 2000,
                    "max_delay_ms": 5000,
                    "allowed_hours": {"start": 6, "end": 22},
                    "respect_robots_txt": True,
                },
                "default": {},
            }
        }
        yaml_file = tmp_path / "policies.yaml"
        yaml_file.write_text(yaml.dump(yaml_content))

        policies = load_domain_policies(str(yaml_file))

        assert policies["linkedin.com"].allowed_hours is not None
        assert policies["linkedin.com"].allowed_hours.start == 6
        assert policies["linkedin.com"].allowed_hours.end == 22
