"""SayknowMind Python SDK Client."""

from __future__ import annotations
from typing import Optional
import json

import httpx

from .types import (
    SearchResult,
    SearchResponse,
    IngestResponse,
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
        offset: int = 0,
        category_ids: Optional[list[str]] = None,
        date_range: Optional[dict[str, str]] = None,
        tags: Optional[list[str]] = None,
    ) -> SearchResponse:
        """Search the knowledge base.

        Filter fields are sent nested under ``filters`` as the server expects:
        ``{"query": ..., "filters": {"categoryIds": [...], ...}}``.
        """
        body: dict = {
            "query": query,
            "mode": mode,
            "limit": limit,
            "offset": offset,
        }
        filters: dict = {}
        if category_ids:
            filters["categoryIds"] = category_ids
        if date_range:
            filters["dateRange"] = date_range
        if tags:
            filters["tags"] = tags
        if filters:
            body["filters"] = filters

        data = self._request("POST", "/api/search", json=body)
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

    def chat(
        self,
        message: str,
        conversation_id: Optional[str] = None,
        **kwargs,
    ) -> ChatResponse:
        """Send a chat message and aggregate the SSE stream into a ChatResponse.

        The server always returns ``text/event-stream``.  This method reads all
        ``answer`` token events and joins them, collects ``sources`` into
        citations, and captures ``conversationId``/``messageId`` from the
        ``done`` event.
        """
        payload: dict = {"message": message}
        if conversation_id:
            payload["conversationId"] = conversation_id
        payload.update(kwargs)

        url = f"{self.base_url}/api/chat"
        headers = {**self._headers(), "Accept": "text/event-stream"}

        answer_tokens: list[str] = []
        citations: list[Citation] = []
        conversation_id_resp = ""
        message_id = ""

        with self._client.stream(
            "POST",
            url,
            headers=headers,
            json=payload,
            timeout=90.0,
        ) as response:
            if response.status_code >= 400:
                body = response.read()
                try:
                    err = json.loads(body)
                    raise SayknowMindError(
                        err.get("code", response.status_code),
                        err.get("message", ""),
                    )
                except (json.JSONDecodeError, KeyError):
                    raise SayknowMindError(response.status_code, body.decode())

            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    ev = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                ev_type = ev.get("type")
                if ev_type == "answer":
                    token = ev.get("token", "")
                    if token:
                        answer_tokens.append(token)
                elif ev_type == "sources":
                    for s in ev.get("sources", []):
                        citations.append(Citation(
                            document_id=s.get("id", ""),
                            title=s.get("title", ""),
                            excerpt=s.get("excerpt", ""),
                            relevance_score=s.get("score", 0.0),
                            url=s.get("url"),
                        ))
                elif ev_type == "done":
                    conversation_id_resp = ev.get("conversationId", "")
                    message_id = ev.get("messageId", "")

        return ChatResponse(
            conversation_id=conversation_id_resp,
            message_id=message_id,
            answer="".join(answer_tokens),
            citations=citations,
            related_documents=[],
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
        """Create a category.

        The server returns ``{categoryId, name, path: list[str]}`` —
        ``categoryId`` is mapped to ``id`` and ``path`` segments are joined.
        """
        data = self._request("POST", "/api/categories", json={"name": name, **kwargs})
        path_parts: list[str] = data.get("path", [name])
        return Category(
            id=data["categoryId"],  # server uses "categoryId", not "id"
            name=data["name"],
            depth=len(path_parts) - 1 if path_parts else 0,
            path="/".join(path_parts),
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
