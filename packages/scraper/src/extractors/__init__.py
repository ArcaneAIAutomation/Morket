"""Page extractors package — pluggable registry + base class."""

from src.extractors.base import BaseExtractor
from src.extractors.job_posting import JobPostingExtractor
from src.extractors.registry import ExtractorRegistry

__all__ = ["BaseExtractor", "ExtractorRegistry", "JobPostingExtractor"]
