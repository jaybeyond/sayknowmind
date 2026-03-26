.PHONY: install dev dev-web dev-dashboard dev-ai dev-all dev-stop dev-status up down logs build clean help

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

dev-all: ## Start ALL services (PostgreSQL+Ollama must be running)
	./scripts/start-all.sh

dev-stop: ## Stop all services started by dev-all
	./scripts/stop-all.sh

dev-status: ## Show status of all services
	@for svc in "Web:3000" "AI-Server:4000" "EdgeQuake:8080" "MCP-Server:8082" "IPFS:5001" "Ollama:11434" "PostgreSQL:5433"; do \
		name=$${svc%%:*}; port=$${svc#*:}; \
		if lsof -i :$$port -sTCP:LISTEN >/dev/null 2>&1; then \
			printf "  ✅ %-14s port %s\n" "$$name" "$$port"; \
		else \
			printf "  ❌ %-14s port %s\n" "$$name" "$$port"; \
		fi; \
	done

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

# --- Deploy ---
migrate: ## Run database migrations
	./db/migrations/scripts/migrate.sh "$(DATABASE_URL)"

deploy-staging: ## Deploy to staging (requires DEPLOY_HOST)
	TAG=$$(git rev-parse --short HEAD) docker compose -f docker-compose.yml pull
	TAG=$$(git rev-parse --short HEAD) docker compose -f docker-compose.yml up -d --remove-orphans

release: ## Create a new release tag (usage: make release v=0.1.1)
	@if [ -z "$(v)" ]; then echo "Usage: make release v=0.1.1"; exit 1; fi
	git tag -a v$(v) -m "Release v$(v)"
	git push origin v$(v)
	@echo "Release v$(v) tagged and pushed. GitHub Actions will build artifacts."

# --- Desktop ---
desktop-dev: ## Run desktop app in dev mode
	cd apps/desktop && cargo tauri dev

desktop-build: ## Build desktop app for current platform
	cd apps/web && pnpm build
	cd apps/desktop && cargo tauri build

# --- Mobile ---
mobile-android: ## Build Android APK
	cd apps/web && pnpm build
	cd apps/mobile && npx cap sync android
	cd apps/mobile/android && ./gradlew assembleRelease

mobile-ios: ## Build iOS (macOS only)
	cd apps/web && pnpm build
	cd apps/mobile && npx cap sync ios
