"""SayknowMind Python SDK - Personal Agentic Second Brain"""

from .client import SayknowMindClient
from .types import (
    SearchParams,
    SearchResult,
    SearchResponse,
    IngestResponse,
    ChatParams,
    ChatResponse,
    Category,
)

__version__ = "0.1.0"
__all__ = [
    "SayknowMindClient",
    "SearchParams",
    "SearchResult",
    "SearchResponse",
    "IngestResponse",
    "ChatParams",
    "ChatResponse",
    "Category",
]
