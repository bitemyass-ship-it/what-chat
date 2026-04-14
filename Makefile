SHELL := /bin/zsh

.DEFAULT_GOAL := help

DEV_RUNTIME_DIR := .tmp/dev
BACKEND_PID_FILE := $(DEV_RUNTIME_DIR)/backend.pid
FRONTEND_PID_FILE := $(DEV_RUNTIME_DIR)/frontend.pid
BACKEND_LOG_FILE := $(DEV_RUNTIME_DIR)/backend.log
FRONTEND_LOG_FILE := $(DEV_RUNTIME_DIR)/frontend.log

.PHONY: help install dev dev-seed clean dev-backend dev-frontend build build-backend build-frontend start test ci-build ci-run ci-stop

help:
	@printf "Available targets:\n"
	@printf "  make install         Install backend and frontend dependencies\n"
	@printf "  make dev             Start backend and frontend in background\n"
	@printf "  make dev-seed        Reset the dev database and seed demo chats/messages\n"
	@printf "  make clean        Stop backend and frontend started by make dev\n"
	@printf "  make dev-backend     Run backend only in development mode\n"
	@printf "  make dev-frontend    Run frontend only in development mode\n"
	@printf "  make build           Build backend and frontend\n"
	@printf "  make build-backend   Build backend TypeScript project\n"
	@printf "  make build-frontend  Build frontend Next.js app\n"
	@printf "  make start           Run backend production build\n"
	@printf "  make test            Run backend test suite\n"
	@printf "  make ci-build        Install deps, build backend and frontend, create .deploy.env template\n"
	@printf "  make ci-run          Start or restart the app via pm2 using .deploy.env\n"
	@printf "  make ci-stop         Stop both pm2 processes\n"

node_modules: package.json package-lock.json
	npm install

frontend/node_modules: frontend/package.json frontend/package-lock.json
	npm --prefix frontend install

install: node_modules frontend/node_modules

dev-backend:
	npm run dev

dev-frontend:
	npm run frontend:dev

dev-seed: node_modules
	npm run dev:seed

up: dev-seed
	@mkdir -p $(DEV_RUNTIME_DIR)
	@if [ -f $(BACKEND_PID_FILE) ] || [ -f $(FRONTEND_PID_FILE) ]; then \
		printf "Dev processes already started. Run 'make clean' first if you want to restart them.\n"; \
		exit 1; \
	fi
	@nohup npm run dev > $(BACKEND_LOG_FILE) 2>&1 & echo $$! > $(BACKEND_PID_FILE)
	@nohup npm run frontend:dev > $(FRONTEND_LOG_FILE) 2>&1 & echo $$! > $(FRONTEND_PID_FILE)
	@printf "Backend started on http://localhost:3050 (pid %s)\n" "$$(cat $(BACKEND_PID_FILE))"
	@printf "Frontend started on http://localhost:3051 (pid %s)\n" "$$(cat $(FRONTEND_PID_FILE))"
	@printf "Logs:\n"
	@printf "  %s\n" "$(BACKEND_LOG_FILE)"
	@printf "  %s\n" "$(FRONTEND_LOG_FILE)"

clean:
	@if [ -f $(BACKEND_PID_FILE) ]; then \
		kill "$$(cat $(BACKEND_PID_FILE))" 2>/dev/null || true; \
		rm -f $(BACKEND_PID_FILE); \
		printf "Backend stopped\n"; \
	else \
		printf "Backend is not running\n"; \
	fi
	@if [ -f $(FRONTEND_PID_FILE) ]; then \
		kill "$$(cat $(FRONTEND_PID_FILE))" 2>/dev/null || true; \
		rm -f $(FRONTEND_PID_FILE); \
		printf "Frontend stopped\n"; \
	else \
		printf "Frontend is not running\n"; \
	fi

build-backend: node_modules
	npm run build

build-frontend: frontend/node_modules
	npm run frontend:build

build: build-backend build-frontend

start: node_modules
	npm start

test: node_modules
	npm test

DEPLOY_ENV_FILE := .deploy.env
DB_FILE := database/whatsapp-monitor.sqlite

ci-build:
	npm ci
	npm --prefix frontend ci
	npm run build
	npm run frontend:build
	@mkdir -p database
	@if [ ! -f $(DB_FILE) ]; then \
		touch $(DB_FILE); \
		printf "Created %s\n" "$(DB_FILE)"; \
	else \
		printf "%s already exists, skipping\n" "$(DB_FILE)"; \
	fi
	@if [ -f $(DEPLOY_ENV_FILE) ]; then \
		printf "%s already exists, skipping\n" "$(DEPLOY_ENV_FILE)"; \
	else \
		printf "AUTH_PASSWORD=\nWHATSAPP_DATABASE_PATH=\nWHATSAPP_SESSION_DIR=\nEMPLOYEES_API_BASE_URL=\n" > $(DEPLOY_ENV_FILE); \
		printf "Created %s — fill in the remaining values before starting pm2\n" "$(DEPLOY_ENV_FILE)"; \
	fi
	@printf "\n[reminder] If this is a fresh server, run 'pm2 startup' and execute the printed command to enable boot persistence.\n"

ci-stop:
	pm2 delete whatsapp-monitor-backend whatsapp-monitor-frontend
	pm2 save --force

ci-run:
	@if [ ! -f $(DEPLOY_ENV_FILE) ]; then \
		printf "Error: %s not found. Run 'make ci-build' first.\n" "$(DEPLOY_ENV_FILE)"; \
		exit 1; \
	fi
	set -a && . ./$(DEPLOY_ENV_FILE) && set +a && \
	if pm2 id whatsapp-monitor-backend | grep -q '[0-9]'; then \
		pm2 restart ecosystem.config.cjs --env production --update-env; \
	else \
		pm2 start ecosystem.config.cjs --env production; \
	fi
	pm2 save
