// Package sayknowmind provides the official Go SDK for SayknowMind Agentic Second Brain.
package sayknowmind

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client is the SayknowMind API client.
type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

// Option is a functional option for configuring the Client.
type Option func(*Client)

// WithToken sets the authentication token.
func WithToken(token string) Option {
	return func(c *Client) { c.Token = token }
}

// WithTimeout sets the HTTP client timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.HTTPClient.Timeout = d }
}

// NewClient creates a new SayknowMind client.
func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		BaseURL:    baseURL,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// --- Types ---

type Citation struct {
	DocumentID     string  `json:"documentId"`
	Title          string  `json:"title"`
	URL            string  `json:"url,omitempty"`
	Excerpt        string  `json:"excerpt"`
	RelevanceScore float64 `json:"relevanceScore"`
}

type SearchResult struct {
	DocumentID string     `json:"documentId"`
	Title      string     `json:"title"`
	Snippet    string     `json:"snippet"`
	Score      float64    `json:"score"`
	Citations  []Citation `json:"citations"`
}

type SearchResponse struct {
	Results    []SearchResult `json:"results"`
	TotalCount int            `json:"totalCount"`
	Took       int            `json:"took"`
}

// DateRange is an inclusive date range filter for search.
type DateRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// SearchFilters groups optional search filter fields that the server expects
// nested under the "filters" key in the request body.
type SearchFilters struct {
	CategoryIDs []string   `json:"categoryIds,omitempty"`
	DateRange   *DateRange `json:"dateRange,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
}

type IngestResponse struct {
	DocumentID string `json:"documentId"`
	JobID      string `json:"jobId"`
	Title      string `json:"title"`
}

type ChatResponse struct {
	ConversationID   string     `json:"conversationId"`
	MessageID        string     `json:"messageId"`
	Answer           string     `json:"answer"`
	Citations        []Citation `json:"citations"`
	RelatedDocuments []string   `json:"relatedDocuments"`
}

// ChatOptions carries optional parameters for Chat. Pass nil to start a new
// conversation with defaults.
//
// NOTE: Chat previously took a positional second string that meant `mode`; it
// now means conversation. Options are a struct (not a bare string) so old
// `Chat(msg, "simple")` call sites fail to COMPILE rather than silently sending
// the wrong field (CODE-REVIEW C12).
type ChatOptions struct {
	// ConversationID resumes an existing conversation. Empty starts a new one.
	ConversationID string
}

type Category struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ParentID    string `json:"parentId,omitempty"`
	Description string `json:"description,omitempty"`
	Color       string `json:"color,omitempty"`
	Depth       int    `json:"depth"`
	Path        string `json:"path"`
}

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("sayknowmind: %d - %s", e.Code, e.Message)
}

// --- Internal helpers ---

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		if json.Unmarshal(respBody, &apiErr) == nil && apiErr.Message != "" {
			return nil, &apiErr
		}
		return nil, &APIError{Code: resp.StatusCode, Message: string(respBody)}
	}

	return respBody, nil
}

// sseStrVal extracts a string value from an unmarshalled SSE event map.
func sseStrVal(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// sseFloatVal extracts a float64 value from an unmarshalled SSE event map.
func sseFloatVal(m map[string]interface{}, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}

// --- API Methods ---

// Search executes a search query against the knowledge base.
// filters may be nil when no filtering is needed.
func (c *Client) Search(query string, mode string, limit int, filters *SearchFilters) (*SearchResponse, error) {
	if mode == "" {
		mode = "hybrid"
	}
	if limit <= 0 {
		limit = 10
	}

	body := map[string]interface{}{
		"query": query,
		"mode":  mode,
		"limit": limit,
	}
	if filters != nil {
		body["filters"] = filters
	}

	data, err := c.doRequest("POST", "/api/search", body)
	if err != nil {
		return nil, err
	}

	var result SearchResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal search response: %w", err)
	}
	return &result, nil
}

// IngestURL ingests content from a URL.
func (c *Client) IngestURL(url string) (*IngestResponse, error) {
	data, err := c.doRequest("POST", "/api/ingest/url", map[string]string{"url": url})
	if err != nil {
		return nil, err
	}
	var result IngestResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal ingest response: %w", err)
	}
	return &result, nil
}

// IngestText ingests plain text content.
func (c *Client) IngestText(content, title string) (*IngestResponse, error) {
	body := map[string]string{"content": content, "title": title}
	data, err := c.doRequest("POST", "/api/ingest/text", body)
	if err != nil {
		return nil, err
	}
	var result IngestResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal ingest response: %w", err)
	}
	return &result, nil
}

// Chat sends a message and aggregates the SSE stream into a ChatResponse.
// The server always returns text/event-stream; this method reads all
// "answer" token events and joins them into Answer, collects sources into
// Citations, and captures conversationId/messageId from the "done" event.
// Pass nil opts (or an empty ConversationID) to start a new conversation.
func (c *Client) Chat(message string, opts *ChatOptions) (*ChatResponse, error) {
	payload := map[string]interface{}{
		"message": message,
	}
	if opts != nil && opts.ConversationID != "" {
		payload["conversationId"] = opts.ConversationID
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.BaseURL+"/api/chat", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	// Use a longer timeout for streaming responses.
	streamClient := *c.HTTPClient
	if streamClient.Timeout < 90*time.Second {
		streamClient.Timeout = 90 * time.Second
	}
	resp, err := streamClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		var apiErr APIError
		if json.Unmarshal(b, &apiErr) == nil && apiErr.Message != "" {
			return nil, &apiErr
		}
		return nil, &APIError{Code: resp.StatusCode, Message: string(b)}
	}

	var answerParts []string
	var citations []Citation
	var convID, msgID string

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var ev map[string]interface{}
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			continue
		}
		switch ev["type"] {
		case "answer":
			if tok := sseStrVal(ev, "token"); tok != "" {
				answerParts = append(answerParts, tok)
			}
		case "sources":
			srcs, _ := ev["sources"].([]interface{})
			for _, s := range srcs {
				sm, ok := s.(map[string]interface{})
				if !ok {
					continue
				}
				citations = append(citations, Citation{
					DocumentID:     sseStrVal(sm, "id"),
					Title:          sseStrVal(sm, "title"),
					URL:            sseStrVal(sm, "url"),
					Excerpt:        sseStrVal(sm, "excerpt"),
					RelevanceScore: sseFloatVal(sm, "score"),
				})
			}
		case "done":
			convID = sseStrVal(ev, "conversationId")
			msgID = sseStrVal(ev, "messageId")
		case "error":
			// Server-signalled failure mid-stream — return an error instead of a
			// blank answer (CODE-REVIEW C14).
			msg := sseStrVal(ev, "message")
			if msg == "" {
				msg = "chat stream error"
			}
			return nil, &APIError{Code: resp.StatusCode, Message: msg}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading SSE stream: %w", err)
	}

	return &ChatResponse{
		ConversationID:   convID,
		MessageID:        msgID,
		Answer:           strings.Join(answerParts, ""),
		Citations:        citations,
		RelatedDocuments: []string{},
	}, nil
}

// GetCategories lists all categories.
func (c *Client) GetCategories() ([]Category, error) {
	data, err := c.doRequest("GET", "/api/categories", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Categories []Category `json:"categories"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal categories: %w", err)
	}
	return result.Categories, nil
}

// CreateCategory creates a new category.
// The server responds with {categoryId, name, path: []string}; this maps to Category.
func (c *Client) CreateCategory(name string, parentID string) (*Category, error) {
	body := map[string]string{"name": name}
	if parentID != "" {
		body["parentId"] = parentID
	}
	data, err := c.doRequest("POST", "/api/categories", body)
	if err != nil {
		return nil, err
	}
	// Server returns {categoryId, name, path: string[]} — not {id, path: string}.
	var raw struct {
		CategoryID string   `json:"categoryId"`
		Name       string   `json:"name"`
		Path       []string `json:"path"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal category: %w", err)
	}
	depth := 0
	if len(raw.Path) > 0 {
		depth = len(raw.Path) - 1
	}
	return &Category{
		ID:    raw.CategoryID,
		Name:  raw.Name,
		Path:  strings.Join(raw.Path, "/"),
		Depth: depth,
	}, nil
}
