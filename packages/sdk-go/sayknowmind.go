// Package sayknowmind provides the official Go SDK for SayknowMind Agentic Second Brain.
package sayknowmind

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// --- API Methods ---

// Search executes a search query against the knowledge base.
func (c *Client) Search(query string, mode string, limit int) (*SearchResponse, error) {
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

// Chat sends a message and gets a response.
func (c *Client) Chat(message, mode string) (*ChatResponse, error) {
	if mode == "" {
		mode = "simple"
	}
	body := map[string]string{"message": message, "mode": mode}
	data, err := c.doRequest("POST", "/api/chat", body)
	if err != nil {
		return nil, err
	}
	var result ChatResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal chat response: %w", err)
	}
	return &result, nil
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
func (c *Client) CreateCategory(name string, parentID string) (*Category, error) {
	body := map[string]string{"name": name}
	if parentID != "" {
		body["parentId"] = parentID
	}
	data, err := c.doRequest("POST", "/api/categories", body)
	if err != nil {
		return nil, err
	}
	var result Category
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal category: %w", err)
	}
	return &result, nil
}
