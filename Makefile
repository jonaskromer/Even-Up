COMPOSE = docker compose -f docker-compose.prod.yml

.DEFAULT_GOAL := help

.PHONY: dev dev-setup deploy pull build up down restart logs ps clean help

dev: dev-setup ## Start local dev (db + api + web, hot reload) — Ctrl+C stops both
	@trap 'kill 0' INT TERM EXIT; \
	(cd apps/api && npm run dev) & \
	(cd apps/web && npm run dev) & \
	wait

dev-setup: ## Idempotent local dev setup: start db, ensure .env, migrate, seed
	docker compose up -d --wait
	@test -f .env || cp .env.example .env
	cd apps/api && npx prisma generate
	cd apps/api && npx prisma migrate deploy
	cd apps/api && npx prisma db seed

deploy: pull build up ## Pull latest code, rebuild images, and (re)start the stack

pull: ## git pull latest changes
	git pull

build: ## Build the production Docker images
	$(COMPOSE) build

up: ## Start the stack in the background
	$(COMPOSE) up -d

down: ## Stop and remove the stack (keeps the database volume)
	$(COMPOSE) down

restart: down up ## Restart the stack without rebuilding

logs: ## Tail logs for all services (use SERVICE=api to filter one)
	$(COMPOSE) logs -f $(SERVICE)

ps: ## Show container status
	$(COMPOSE) ps

clean: ## Stop the stack and wipe the database volume
	$(COMPOSE) down -v

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-10s\033[0m %s\n", $$1, $$2}'
