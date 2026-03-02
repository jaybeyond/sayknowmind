.PHONY: install dev dev-web dev-dashboard dev-ai up down logs build clean help

# ============================================
# SayknowMind v0.1.0 - Development Commands
# ============================================

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# --- Install ---
install: ## Install all dependencies
	cd apps/web && pnpm install
	cd apps/dashboard && pnpm install
	cd apps/ai-server && npm install
	cd packages/mcp-server && npm install

# --- Development ---
dev-web: ## Run frontend dev server (port 3000)
	cd apps/web && pnpm dev

dev-dashboard: ## Run RAG dashboard dev server (port 3001)
	cd apps/dashboard && pnpm dev

dev-ai: ## Run AI server dev mode (port 4000)
	cd apps/ai-server && npm run start:dev

# --- Docker ---
up: ## Start all services with Docker Compose
	docker compose up -d

down: ## Stop all services
	docker compose down

logs: ## Follow all service logs
	docker compose logs -f

build: ## Build all Docker images
	docker compose build

clean: ## Stop services and remove volumes
	docker compose down -v
	rm -rf apps/web/.next apps/dashboard/.next apps/ai-server/dist

# --- Database ---
db-reset: ## Reset database (WARNING: destroys data)
	docker compose down -v
	docker compose up -d postgres
	@echo "Waiting for PostgreSQL..."
	@sleep 5
	@echo "Database reset complete"

# --- Status ---
status: ## Show service status
	docker compose ps
