"""Unit tests for the ResultNormalizer."""

from src.models.normalizer import (
    ResultNormalizer,
    clean_text,
    normalize_location,
    normalize_url,
    strip_html,
    normalize_whitespace,
)
from src.models.requests import TargetType
from src.models.schemas import (
    CompanyWebsiteResult,
    JobPostingResult,
    LinkedInProfileResult,
    NormalizedLocation,
)


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------


class TestStripHtml:
    def test_removes_simple_tags(self):
        assert strip_html("<p>hello</p>") == "hello"

    def test_removes_nested_tags(self):
        assert strip_html("<div><b>bold</b> text</div>") == "bold text"

    def test_no_tags(self):
        assert strip_html("plain text") == "plain text"

    def test_empty_string(self):
        assert strip_html("") == ""

    def test_self_closing_tags(self):
        assert strip_html("line1<br/>line2") == "line1line2"


class TestNormalizeWhitespace:
    def test_collapses_spaces(self):
        assert normalize_whitespace("hello   world") == "hello world"

    def test_collapses_newlines(self):
        assert normalize_whitespace("hello\n\nworld") == "hello world"

    def test_trims(self):
        assert normalize_whitespace("  hello  ") == "hello"

    def test_mixed_whitespace(self):
        assert normalize_whitespace(" \t hello \n world \t ") == "hello world"


class TestCleanText:
    def test_strips_html_and_normalizes(self):
        assert clean_text("<p>  hello   </p>  <b>world</b>") == "hello world"

    def test_empty(self):
        assert clean_text("") == ""


class TestNormalizeUrl:
    def test_adds_https_scheme(self):
        assert normalize_url("example.com/path") == "https://example.com/path"

    def test_replaces_http_with_https(self):
        assert normalize_url("http://example.com/path") == "https://example.com/path"

    def test_keeps_https(self):
        assert normalize_url("https://example.com/path") == "https://example.com/path"

    def test_handles_double_slash_prefix(self):
        assert normalize_url("//example.com/path") == "https://example.com/path"

    def test_removes_utm_params(self):
        url = "https://example.com/page?utm_source=google&utm_medium=cpc&id=123"
        result = normalize_url(url)
        assert "utm_source" not in result
        assert "utm_medium" not in result
        assert "id=123" in result

    def test_removes_fbclid(self):
        url = "https://example.com/page?fbclid=abc123&valid=1"
        result = normalize_url(url)
        assert "fbclid" not in result
        assert "valid=1" in result

    def test_removes_gclid(self):
        url = "https://example.com/page?gclid=xyz&keep=yes"
        result = normalize_url(url)
        assert "gclid" not in result
        assert "keep=yes" in result

    def test_removes_all_utm_variants(self):
        url = "https://example.com/?utm_campaign=test&utm_content=ad&utm_term=kw"
        result = normalize_url(url)
        assert "utm_campaign" not in result
        assert "utm_content" not in result
        assert "utm_term" not in result

    def test_empty_string(self):
        assert normalize_url("") == ""

    def test_strips_whitespace(self):
        assert normalize_url("  https://example.com  ") == "https://example.com"

    def test_drops_fragment(self):
        result = normalize_url("https://example.com/page#section")
        assert "#" not in result


class TestNormalizeLocation:
    def test_single_part(self):
        loc = normalize_location("San Francisco")
        assert loc.city == "San Francisco"
        assert loc.state_region is None
        assert loc.country is None
        assert loc.raw == "San Francisco"

    def test_two_parts(self):
        loc = normalize_location("London, United Kingdom")
        assert loc.city == "London"
        assert loc.country == "United Kingdom"
        assert loc.state_region is None

    def test_three_parts(self):
        loc = normalize_location("San Francisco, California, United States")
        assert loc.city == "San Francisco"
        assert loc.state_region == "California"
        assert loc.country == "United States"

    def test_preserves_raw(self):
        raw = "  San Francisco,  CA , US  "
        loc = normalize_location(raw)
        assert loc.raw == raw

    def test_strips_html_in_location(self):
        loc = normalize_location("<b>Berlin</b>, <i>Germany</i>")
        assert loc.city == "Berlin"
        assert loc.country == "Germany"

    def test_empty_string(self):
        loc = normalize_location("")
        assert loc.city is None
        assert loc.state_region is None
        assert loc.country is None
        assert loc.raw == ""


# ---------------------------------------------------------------------------
# ResultNormalizer tests
# ---------------------------------------------------------------------------


class TestResultNormalizerLinkedIn:
    def setup_method(self):
        self.normalizer = ResultNormalizer()

    def test_basic_normalization(self):
        raw = {
            "name": "<b>John Doe</b>",
            "headline": "  Software   Engineer  ",
            "current_company": "<p>Acme Corp</p>",
            "location": "San Francisco, CA, US",
            "summary": "<div>A great engineer</div>",
            "profile_url": "http://linkedin.com/in/johndoe?utm_source=google",
        }
        result = self.normalizer.normalize(raw, TargetType.LINKEDIN_PROFILE)
        assert isinstance(result, LinkedInProfileResult)
        assert result.name == "John Doe"
        assert result.headline == "Software Engineer"
        assert result.current_company == "Acme Corp"
        assert result.location is not None
        assert result.location.city == "San Francisco"
        assert result.location.state_region == "CA"
        assert result.location.country == "US"
        assert result.summary == "A great engineer"
        assert "utm_source" not in result.profile_url
        assert result.profile_url.startswith("https://")

    def test_missing_fields_are_none(self):
        raw = {"name": "Jane"}
        result = self.normalizer.normalize(raw, TargetType.LINKEDIN_PROFILE)
        assert isinstance(result, LinkedInProfileResult)
        assert result.name == "Jane"
        assert result.headline is None
        assert result.location is None

    def test_none_values_preserved(self):
        raw = {"name": None, "headline": "Test"}
        result = self.normalizer.normalize(raw, TargetType.LINKEDIN_PROFILE)
        assert result.name is None
        assert result.headline == "Test"


class TestResultNormalizerCompanyWebsite:
    def setup_method(self):
        self.normalizer = ResultNormalizer()

    def test_basic_normalization(self):
        raw = {
            "company_name": "<h1>Acme Inc</h1>",
            "description": "<p>We build   things</p>",
            "headquarters": "New York, NY, USA",
            "website_url": "http://acme.com?fbclid=abc",
        }
        result = self.normalizer.normalize(raw, TargetType.COMPANY_WEBSITE)
        assert isinstance(result, CompanyWebsiteResult)
        assert result.company_name == "Acme Inc"
        assert result.description == "We build things"
        assert result.headquarters.city == "New York"
        assert result.headquarters.state_region == "NY"
        assert "fbclid" not in result.website_url
        assert result.website_url.startswith("https://")


class TestResultNormalizerJobPosting:
    def setup_method(self):
        self.normalizer = ResultNormalizer()

    def test_basic_normalization(self):
        raw = {
            "job_title": "<span>Senior Dev</span>",
            "company_name": "BigCo",
            "location": "Austin, Texas",
            "salary_range": "$100k - $150k",
            "description": "<div>Great   job</div>",
            "posting_url": "https://jobs.example.com/123?gclid=xyz",
        }
        result = self.normalizer.normalize(raw, TargetType.JOB_POSTING)
        assert isinstance(result, JobPostingResult)
        assert result.job_title == "Senior Dev"
        assert result.location.city == "Austin"
        assert result.location.country == "Texas"
        assert result.description == "Great job"
        assert "gclid" not in result.posting_url


class TestResultNormalizerPartialResult:
    def setup_method(self):
        self.normalizer = ResultNormalizer()

    def test_invalid_field_type_returns_partial(self):
        # location expects str or dict, not an int — should produce partial result
        raw = {
            "name": "Valid Name",
            "location": 12345,  # invalid type for location field
        }
        result = self.normalizer.normalize(raw, TargetType.LINKEDIN_PROFILE)
        assert isinstance(result, LinkedInProfileResult)
        assert result.name == "Valid Name"

    def test_empty_dict_returns_empty_model(self):
        result = self.normalizer.normalize({}, TargetType.LINKEDIN_PROFILE)
        assert isinstance(result, LinkedInProfileResult)
        assert result.name is None

    def test_location_as_dict(self):
        raw = {
            "location": {
                "city": "<b>Berlin</b>",
                "state_region": "  Berlin  ",
                "country": "Germany",
                "raw": "Berlin, Berlin, Germany",
            }
        }
        result = self.normalizer.normalize(raw, TargetType.LINKEDIN_PROFILE)
        assert result.location.city == "Berlin"
        assert result.location.state_region == "Berlin"
        assert result.location.country == "Germany"
        assert result.location.raw == "Berlin, Berlin, Germany"
