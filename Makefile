# =============================================================================
# BORJIE - Development & Infrastructure Commands
# =============================================================================
# Usage: make <target>
# Run 'make help' to see all available targets
# =============================================================================

.PHONY: help install dev build test lint typecheck clean \
        docker-build docker-up docker-down docker-logs docker-clean \
        tf-init tf-plan tf-apply tf-destroy \
        k8s-apply k8s-delete k8s-status \
        deploy-staging deploy-production \
        graph-init graph-sync graph-browser docker-shell-neo4j \
        pilot-summary pilot-auto-assign pilot-provision

# Default target
.DEFAULT_GOAL := help

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------
help: ## Show this help message
	@echo "BORJIE - Available Commands"
	@echo "================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# -----------------------------------------------------------------------------
# Development
# -----------------------------------------------------------------------------
install: ## Install dependencies
	pnpm install

dev: ## Start development servers
	pnpm exec turbo dev

build: ## Build all packages
	pnpm exec turbo build

test: ## Run all tests
	pnpm exec turbo test

lint: ## Run linting
	pnpm exec turbo lint

typecheck: ## Run TypeScript type checking
	pnpm exec turbo typecheck

clean: ## Clean all build artifacts
	pnpm exec turbo clean
	rm -rf node_modules .turbo

# -----------------------------------------------------------------------------
# Docker - Local Development
# -----------------------------------------------------------------------------
docker-build: ## Build all Docker images
	docker compose build

docker-build-nc: ## Build Docker images without cache
	docker compose build --no-cache

docker-up: ## Start all services (detached)
	docker compose up -d

docker-up-dev: ## Start services with dev overrides (hot reload)
	docker compose -f docker-compose.yml -f docker-compose.override.yml up -d

docker-down: ## Stop all services
	docker compose down

docker-down-v: ## Stop services and remove volumes
	docker compose down -v

docker-logs: ## View logs (all services)
	docker compose logs -f

docker-logs-api: ## View API gateway logs
	docker compose logs -f api-gateway

docker-ps: ## List running containers
	docker compose ps

docker-clean: ## Remove all containers, volumes, images
	docker compose down -v --rmi local --remove-orphans 2>/dev/null || true

docker-shell-api: ## Shell into API gateway container
	docker compose exec api-gateway sh

docker-shell-db: ## Connect to PostgreSQL
	docker compose exec postgres psql -U borjie -d borjie

# -----------------------------------------------------------------------------
# Terraform - Infrastructure
# -----------------------------------------------------------------------------
TF_DIR ?= infrastructure/terraform
TF_ENV ?= staging

tf-init: ## Initialize Terraform (TF_ENV=staging|production)
	cd $(TF_DIR)/environments/$(TF_ENV) && \
	terraform init -backend-config=backend.hcl

tf-plan: ## Plan Terraform changes
	cd $(TF_DIR)/environments/$(TF_ENV) && \
	terraform plan -var-file=$(TF_ENV).tfvars -out=tfplan

tf-apply: ## Apply Terraform changes
	cd $(TF_DIR)/environments/$(TF_ENV) && \
	terraform apply tfplan

tf-destroy: ## Destroy Terraform infrastructure (DANGER!)
	@echo "WARNING: This will destroy all infrastructure in $(TF_ENV)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	cd $(TF_DIR)/environments/$(TF_ENV) && \
	terraform destroy -var-file=$(TF_ENV).tfvars

tf-output: ## Show Terraform outputs
	cd $(TF_DIR)/environments/$(TF_ENV) && \
	terraform output

tf-fmt: ## Format Terraform files
	terraform fmt -recursive $(TF_DIR)

tf-validate: ## Validate Terraform configuration
	cd $(TF_DIR) && terraform validate

# -----------------------------------------------------------------------------
# Kubernetes
# -----------------------------------------------------------------------------
K8S_DIR ?= infrastructure/k8s
K8S_ENV ?= staging

k8s-apply: ## Apply Kubernetes manifests (K8S_ENV=staging|production)
	kubectl apply -k $(K8S_DIR)/overlays/$(K8S_ENV)

k8s-delete: ## Delete Kubernetes resources
	kubectl delete -k $(K8S_DIR)/overlays/$(K8S_ENV)

k8s-status: ## Show Kubernetes status
	kubectl get all -n borjie

k8s-logs: ## View pod logs (POD=pod-name)
	kubectl logs -f -n borjie $(POD)

k8s-exec: ## Execute command in pod (POD=pod-name CMD=command)
	kubectl exec -it -n borjie $(POD) -- $(CMD)

k8s-port-forward-api: ## Port forward API gateway
	kubectl port-forward -n borjie svc/api-gateway-service 4000:4000

# -----------------------------------------------------------------------------
# Deployment Shortcuts
# -----------------------------------------------------------------------------
deploy-staging: ## Deploy to staging environment
	@echo "Deploying to staging..."
	$(MAKE) tf-init TF_ENV=staging
	$(MAKE) tf-plan TF_ENV=staging
	$(MAKE) tf-apply TF_ENV=staging
	$(MAKE) k8s-apply K8S_ENV=staging

deploy-production: ## Deploy to production environment
	@echo "WARNING: Deploying to PRODUCTION"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	$(MAKE) tf-init TF_ENV=production
	$(MAKE) tf-plan TF_ENV=production
	$(MAKE) tf-apply TF_ENV=production
	$(MAKE) k8s-apply K8S_ENV=production

# -----------------------------------------------------------------------------
# ECR - Container Registry
# -----------------------------------------------------------------------------
AWS_REGION ?= eu-west-1
AWS_ACCOUNT_ID ?= $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REGISTRY = $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com

ecr-login: ## Login to ECR
	aws ecr get-login-password --region $(AWS_REGION) | \
	docker login --username AWS --password-stdin $(ECR_REGISTRY)

ecr-push-api: ## Build and push API gateway to ECR
	docker build -f docker/Dockerfile.api -t $(ECR_REGISTRY)/borjie/api-gateway:latest .
	docker push $(ECR_REGISTRY)/borjie/api-gateway:latest

ecr-push-all: ecr-login ## Build and push all images to ECR
	@echo "Building and pushing all images..."
	docker build -f docker/Dockerfile.api -t $(ECR_REGISTRY)/borjie/api-gateway:latest .
	docker push $(ECR_REGISTRY)/borjie/api-gateway:latest
	@for app in customer-app estate-manager-app owner-portal admin-portal; do \
		echo "Building $$app..."; \
		docker build -f docker/Dockerfile.web \
			--build-arg APP_NAME=$$app \
			--build-arg APP_PATH=apps/$$app \
			-t $(ECR_REGISTRY)/borjie/$$app:latest .; \
		docker push $(ECR_REGISTRY)/borjie/$$app:latest; \
	done

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------
db-migrate: ## Run database migrations
	pnpm --filter @borjie/database run db:migrate

db-seed: ## Seed database with sample data
	pnpm --filter @borjie/database run db:seed

db-reset: ## Reset database (DANGER!)
	@echo "WARNING: This will delete all data!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	pnpm --filter @borjie/database run db:reset

db-studio: ## Open Drizzle Studio
	pnpm --filter @borjie/database run db:studio

# -----------------------------------------------------------------------------
# Graph Database (Neo4j / CPG)
# -----------------------------------------------------------------------------
graph-init: ## Initialize Neo4j graph (constraints + indexes)
	pnpm --filter @borjie/graph-sync graph:init

graph-sync: ## Run incremental graph sync from PostgreSQL
	pnpm --filter @borjie/graph-sync graph:sync

graph-browser: ## Open Neo4j Browser UI
	@echo "Opening Neo4j Browser at http://localhost:7474"
	@open http://localhost:7474 2>/dev/null || xdg-open http://localhost:7474 2>/dev/null || echo "Open http://localhost:7474 in your browser"

docker-shell-neo4j: ## Connect to Neo4j via cypher-shell
	docker compose exec neo4j cypher-shell -u neo4j -p borjie_graph_dev

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------
env-check: ## Check for missing environment variables
	@echo "Checking environment variables..."
	@[ -f .env ] || (echo "ERROR: .env file not found. Copy .env.example to .env" && exit 1)
	@echo "Environment file exists."

gen-secret: ## Generate a random secret
	@openssl rand -base64 64

setup: install env-check ## Initial project setup
	@echo "Setup complete! Run 'make docker-up' to start services."

# -----------------------------------------------------------------------------
# Pilot triage (Wave PILOT-TRIAGE)
# -----------------------------------------------------------------------------
pilot-summary: ## Daily 1-screen markdown summary of pilot errors (paste into standup)
	@pnpm tsx scripts/triage/summarize-pilot-errors.ts

pilot-auto-assign: ## Suggest assignee for a pilot GitHub issue (ISSUE=<url>)
	@pnpm tsx scripts/triage/auto-assign.ts --issue=$(ISSUE)

# -----------------------------------------------------------------------------
# Pilot human-in-the-loop kit (Wave PILOT-HITL)
# -----------------------------------------------------------------------------
pilot-provision: ## Provision a Supabase pilot user (USER=+255... TENANT=tnt_... COHORT=pilot-...)
	@pnpm tsx scripts/pilot-provision.ts \
		--phone $(USER) \
		--tenant $(TENANT) \
		--cohort $(COHORT)
