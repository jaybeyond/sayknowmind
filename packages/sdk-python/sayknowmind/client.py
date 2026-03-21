"""SayknowMind Python SDK Client."""

from __future__ import annotations
from typing import Optional, AsyncIterator
import json

import httpx

from .types import (
    SearchParams,
    SearchResult,
    SearchResponse,
    IngestResponse,
    ChatParams,
    ChatResponse,
    Category,
    Citation,
)


class SayknowMindError(Exception):
    """Error from SayknowMind API."""

    def __init__(self, code: int, message: str, details: object = None):
        super().__init__(message)
        self.code = code
        self.details = details


class SayknowMindClient:
    """Official Python client for SayknowMind Agentic Second Brain.

    Usage:
        client = SayknowMindClient("http://localhost:3000", token="...")
        results = client.search("AI research")
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        token: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._client = httpx.Client(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _request(self, method: str, path: str, **kwargs) -> dict:
        url = f"{self.base_url}{path}"
        response = self._client.request(method, url, headers=self._headers(), **kwargs)
        if response.status_code >= 400:
            try:
                body = response.json()
                raise SayknowMindError(
                    body.get("code", response.status_code),
                    body.get("message", response.text),
                )
            except (json.JSONDecodeError, KeyError):
                raise SayknowMindError(response.status_code, response.text)
        return response.json()

    # ---- Search ----

    def search(
        self,
        query: str,
        mode: str = "hybrid",
        limit: int = 10,
        **kwargs,
    ) -> SearchResponse:
        data = self._request("POST", "/api/search", json={
            "query": query,
            "mode": mode,
            "limit": limit,
            **kwargs,
        })
        results = [
            SearchResult(
                document_id=r["documentId"],
                title=r["title"],
                snippet=r.get("snippet", ""),
                score=r.get("score", 0),
                citations=[
                    Citation(
                        document_id=c["documentId"],
                        title=c["title"],
                        excerpt=c.get("excerpt", ""),
                        relevance_score=c.get("relevanceScore", 0),
                        url=c.get("url"),
                    )
                    for c in r.get("citations", [])
                ],
            )
            for r in data.get("results", [])
        ]
        return SearchResponse(
            results=results,
            total_count=data.get("totalCount", 0),
            took=data.get("took", 0),
        )

    # ---- Ingestion ----

    def ingest_url(self, url: str, **kwargs) -> IngestResponse:
        data = self._request("POST", "/api/ingest/url", json={"url": url, **kwargs})
        return IngestResponse(
            document_id=data["documentId"],
            job_id=data.get("jobId", ""),
            title=data.get("title", ""),
        )

    def ingest_file(self, file_path: str) -> IngestResponse:
        with open(file_path, "rb") as f:
            files = {"file": (file_path.split("/")[-1], f)}
            headers = {}
            if self.token:
                headers["Authorization"] = f"Bearer {self.token}"
            response = self._client.post(
                f"{self.base_url}/api/ingest/file",
                files=files,
                headers=headers,
            )
        if response.status_code >= 400:
            raise SayknowMindError(response.status_code, response.text)
        data = response.json()
        return IngestResponse(
            document_id=data["documentId"],
            job_id=data.get("jobId", ""),
            title=data.get("title", ""),
        )

    def ingest_text(self, content: str, title: str = "Untitled") -> IngestResponse:
        data = self._request("POST", "/api/ingest/text", json={
            "content": content,
            "title": title,
        })
        return IngestResponse(
            document_id=data["documentId"],
            job_id=data.get("jobId", ""),
            title=data.get("title", ""),
        )

    # ---- Chat ----

    def chat(self, message: str, **kwargs) -> ChatResponse:
        data = self._request("POST", "/api/chat", json={
            "message": message,
            "mode": kwargs.get("mode", "simple"),
            **kwargs,
        })
        return ChatResponse(
            conversation_id=data["conversationId"],
            message_id=data["messageId"],
            answer=data["answer"],
            citations=[
                Citation(
                    document_id=c["documentId"],
                    title=c["title"],
                    excerpt=c.get("excerpt", ""),
                    relevance_score=c.get("relevanceScore", 0),
                    url=c.get("url"),
                )
                for c in data.get("citations", [])
            ],
            related_documents=data.get("relatedDocuments", []),
        )

    # ---- Categories ----

    def get_categories(self) -> list[Category]:
        data = self._request("GET", "/api/categories")
        return [
            Category(
                id=c["id"],
                name=c["name"],
                depth=c.get("depth", 0),
                path=c.get("path", c["name"]),
                parent_id=c.get("parentId"),
                description=c.get("description"),
                color=c.get("color"),
            )
            for c in data.get("categories", [])
        ]

    def create_category(self, name: str, **kwargs) -> Category:
        data = self._request("POST", "/api/categories", json={"name": name, **kwargs})
        return Category(
            id=data["id"],
            name=data["name"],
            depth=data.get("depth", 0),
            path=data.get("path", name),
            parent_id=data.get("parentId"),
            description=data.get("description"),
            color=data.get("color"),
        )

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
