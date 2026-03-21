"""Type definitions for SayknowMind SDK."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Citation:
    document_id: str
    title: str
    excerpt: str
    relevance_score: float
    url: Optional[str] = None


@dataclass
class SearchResult:
    document_id: str
    title: str
    snippet: str
    score: float
    citations: list[Citation] = field(default_factory=list)


@dataclass
class SearchResponse:
    results: list[SearchResult]
    total_count: int
    took: int


@dataclass
class SearchParams:
    query: str
    mode: str = "hybrid"
    limit: int = 10
    offset: int = 0
    category_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None


@dataclass
class IngestResponse:
    document_id: str
    job_id: str
    title: str


@dataclass
class ChatParams:
    message: str
    conversation_id: Optional[str] = None
    mode: str = "simple"
    document_ids: Optional[list[str]] = None
    category_ids: Optional[list[str]] = None


@dataclass
class ChatResponse:
    conversation_id: str
    message_id: str
    answer: str
    citations: list[Citation] = field(default_factory=list)
    related_documents: list[str] = field(default_factory=list)


@dataclass
class Category:
    id: str
    name: str
    depth: int
    path: str
    parent_id: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
