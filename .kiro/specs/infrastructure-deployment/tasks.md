# Implementation Plan: Module 7 — Infrastructure & Deployment

## Overview

Implements the complete infrastructure-as-code, Docker containerization, CI/CD pipelines, and observability configuration for deploying all Morket services to AWS. The plan follows incremental steps: Dockerfiles → Terraform modules (networking → compute → data stores → frontend hosting → secrets → monitoring) → environment configs → GitHub Actions workflows. Each task builds on the previous.

## Tasks

- [x] 1. Docker containerization
  - [x] 1.1 Create `docker/backend.Dockerfile`
    - Multi-stage build: Node.js 20 LTS Alpine build stage (compile TypeScript), production stage (copy compiled JS + production deps only)
    - HEALTHCHECK: `curl -f http://localhost:3000/api/v1/health || exit 1`
    - Non-root USER `morket` (uid 1001)
    - EXPOSE 3000
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 1.2 Create `docker/scraper.Dockerfile`
    - Multi-stage build: Python 3.11-slim, install Playwright + Chromium deps
    - Chromium flags: --no-sandbox, --disable-dev-shm-usage, --disable-gpu
    - HEALTHCHECK: `curl -f http://localhost:8001/health || exit 1`
    - Non-root USER `morket` (uid 1001)
    - EXPOSE 8001
    - _Requirements: 1.2, 1.4, 1.5_

  - [x] 1.3 Create `docker/frontend.Dockerfile`
    - Multi-stage build: Node.js 20 LTS Alpine build stage (`npm run build`), Nginx Alpine production stage serving static assets
    - HEALTHCHECK: `curl -f http://localhost:80/ || exit 1`
    - Non-root USER via Nginx unprivileged config
    - Custom Nginx config for SPA routing (try_files $uri /index.html)
    - EXPOSE 80
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 1.4 Create `docker/.dockerignore`
    - Exclude: node_modules, .git, *.test.ts, tests/, .env, .env.*, coverage/, dist/, __pycache__, .hypothesis/, .pytest_cache/
    - _Requirements: 1.6_

  - [x] 1.5 Create root `docker-compose.yml` for local development
    - Services: backend, scraper, frontend, postgres, clickhouse, redis, rabbitmq, opensearch, temporal
    - Proper networking, volume mounts, health checks, depends_on
    - _Requirements: 1.7_

- [x] 2. Checkpoint — Verify Dockerfiles build successfully
  - Ensure all Dockerfiles have correct syntax and structure.

- [x] 3. Terraform foundation — VPC and networking
  - [x] 3.1 Create `terraform/modules/vpc/` module
    - VPC with configurable CIDR (default 10.0.0.0/16), 2 AZs
    - Public subnets (ALB, NAT) + private subnets (ECS, databases)
    - NAT Gateways (configurable: 1 for staging, 2 for production)
    - Security groups: ALB (443 inbound), ECS (ALB only), Aurora (ECS only on 5432), Redis (ECS only on 6379), RabbitMQ (ECS only on 5671), OpenSearch (ECS only on 443), ClickHouse (ECS only on 8123/9000), Temporal (ECS only on 7233)
    - VPC Flow Logs to CloudWatch
    - Resource tagging: Project=morket, Environment={env}
    - variables.tf, main.tf, outputs.tf
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.2 Create `terraform/modules/ecr/` module
    - ECR repositories: morket-backend, morket-scraper, morket-frontend
    - Image scanning on push, encryption (default KMS)
    - Lifecycle policy: retain 20 tagged images, expire untagged after 7 days
    - Repository policy for ECS task execution role
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 4. Terraform — Compute layer (ECS + ALB)
  - [x] 4.1 Create `terraform/modules/ecs/` module
    - ECS cluster with Fargate capacity providers, container insights enabled
    - Task definitions: backend (512 CPU/1024 MB), scraper (2048 CPU/4096 MB), Temporal worker (512 CPU/1024 MB), Temporal server (1024 CPU/2048 MB)
    - Services: desired count configurable, min healthy 100%, max 200% for rolling deploys
    - Health checks on /health (30s interval, healthy=2, unhealthy=3)
    - Auto-scaling: CPU-based (up at 70%, down at 30%), min 2, max configurable
    - CloudWatch Logs driver per service, configurable retention
    - Secrets from Secrets Manager ARNs in `secrets` block
    - Environment variables in `environment` block
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 19.2, 19.3, 19.6, 19.7_

  - [x] 4.2 Create `terraform/modules/alb/` module
    - ALB in public subnets, HTTPS listener (443) with ACM certificate
    - HTTP listener (80) redirecting to HTTPS
    - Path-based routing: /api/v1/scrape* → scraper, /api/v1/* → backend, default → frontend
    - Access logs to S3 with 90-day lifecycle
    - Request timeout 120s
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 5. Terraform — Data stores
  - [x] 5.1 Create `terraform/modules/aurora/` module
    - Aurora PostgreSQL 15.x cluster: writer + configurable reader replicas
    - Configurable instance class (default db.r6g.large), storage encryption, deletion protection
    - Automated backups (7-day retention), preferred backup window
    - Credentials in Secrets Manager with 30-day auto-rotation
    - Parameter group: pg_stat_statements, log_min_duration_statement=1000
    - Private subnets, DB subnet group, security group (ECS only on 5432)
    - Outputs: cluster endpoint, reader endpoint, secret ARN
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.2 Create `terraform/modules/clickhouse/` module
    - EC2 instance (default m6i.xlarge) in private subnet
    - EBS gp3 volume (default 500 GB, 3000 IOPS) mounted at /var/lib/clickhouse
    - Launch template with user data: install ClickHouse, configure, start
    - Security group: ECS only on 8123/9000
    - AWS Backup for EBS snapshots (7-day retention)
    - Credentials in Secrets Manager
    - Outputs: private IP, port
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 5.3 Create `terraform/modules/redis/` module
    - ElastiCache Redis 7.x, configurable node type (default cache.r6g.large)
    - Single-node (staging) or multi-node with failover (production)
    - Private subnets, cache subnet group, security group (ECS only on 6379)
    - Encryption at rest (KMS) + in transit (TLS)
    - Parameter group: maxmemory-policy=allkeys-lru
    - Automated snapshots (3-day retention)
    - AUTH token in Secrets Manager
    - Outputs: primary endpoint, port
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 5.4 Create `terraform/modules/rabbitmq/` module
    - Amazon MQ RabbitMQ 3.11.x, configurable instance type (default mq.m5.large)
    - Single-instance (staging) or active/standby (production)
    - Private subnets, security group (ECS only on 5671)
    - CloudWatch logging (general + audit)
    - Credentials in Secrets Manager
    - Outputs: AMQPS endpoint, secret ARN
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.5 Create `terraform/modules/opensearch/` module
    - OpenSearch 2.x domain, configurable instance type (default r6g.large.search)
    - EBS gp3 storage (default 100 GB/node), encryption at rest (KMS)
    - Node-to-node encryption, HTTPS enforcement
    - VPC access policy (ECS security group only)
    - Automated snapshots (02:00 UTC)
    - Master user credentials in Secrets Manager
    - Outputs: domain endpoint, secret ARN
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 6. Checkpoint — Verify all Terraform modules validate
  - Run `terraform fmt` and `terraform validate` on each module.

- [x] 7. Terraform — Frontend hosting and secrets
  - [x] 7.1 Create `terraform/modules/s3/` module
    - Frontend assets bucket: versioning, AES-256 encryption, public access blocked
    - Exports bucket: lifecycle (Glacier after 90d, expire after 365d)
    - ALB logs bucket: lifecycle (expire after 90d)
    - Outputs: bucket names, ARNs
    - _Requirements: 10.1, 10.6_

  - [x] 7.2 Create `terraform/modules/cloudfront/` module
    - CloudFront distribution with S3 origin + OAI
    - ACM certificate, HTTPS-only
    - Custom error response: 403/404 → /index.html (200)
    - Cache: 86400s default TTL, 0 TTL for /index.html
    - Outputs: distribution domain name, distribution ID
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.7_

  - [x] 7.3 Create `terraform/modules/secrets/` module
    - Secrets Manager secrets for: Aurora credentials, ClickHouse credentials, Redis AUTH, RabbitMQ credentials, OpenSearch credentials, JWT secret, encryption master key, service API key (X-Service-Key), webhook HMAC secret
    - IAM policies: per-service read access to only required secrets
    - Tags: Project=morket, Environment={env}
    - _Requirements: 11.1, 11.3, 11.6_

  - [x] 7.4 Create `terraform/modules/monitoring/` module
    - CloudWatch Log Groups per ECS service (configurable retention, default 30d)
    - CloudWatch Alarms: ECS CPU >80%, ECS memory >80%, ALB 5xx >5%, ALB response time >2s, Aurora CPU >80%, Aurora memory <500MB, Redis CPU >70%, ClickHouse CPU >80%
    - SNS topic for alarm notifications
    - CloudWatch Dashboard: ECS metrics, ALB metrics, Aurora metrics, Redis metrics, ClickHouse metrics, OpenSearch metrics
    - Log Metric Filters: ERROR-level entries → alarm at >10/min
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [x] 8. Terraform — Temporal server
  - [x] 8.1 Create Temporal server ECS task definition and service within `terraform/modules/ecs/`
    - Official `temporalio/auto-setup` image, 1024 CPU / 2048 MB
    - Environment: Aurora endpoint for persistence + visibility stores, database `temporal`
    - Service discovery: temporal.morket.local
    - Health check on gRPC port 7233
    - Security group: ECS only on 7233
    - Credentials from Secrets Manager
    - Outputs: internal DNS endpoint
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [x] 9. Terraform — Environment configurations
  - [x] 9.1 Create `terraform/environments/staging/` configuration
    - main.tf composing all modules with staging-sized variables
    - variables.tf with all variable declarations
    - terraform.tfvars with staging values (reduced instances, single-AZ, no auto-scaling)
    - backend.tf with S3 state backend + DynamoDB locking
    - versions.tf pinning Terraform >= 1.5.0 and all provider versions
    - outputs.tf exposing all endpoints
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 19.1, 19.4_

  - [x] 9.2 Create `terraform/environments/production/` configuration
    - Same structure as staging with production values (full instances, multi-AZ, auto-scaling enabled)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 19.1, 19.5_

- [x] 10. Checkpoint — Verify Terraform plan succeeds for both environments
  - Run `terraform validate` on staging and production configs.

- [x] 11. GitHub Actions — CI pipeline
  - [x] 11.1 Create `.github/workflows/ci.yml`
    - Trigger: pull requests to main and develop
    - Conditional jobs: backend (lint + typecheck + vitest), scraper (ruff + black + mypy + pytest), frontend (lint + typecheck + vitest), terraform (fmt + validate + plan)
    - Path filters: packages/backend/**, packages/scraper/**, packages/frontend/**, terraform/**
    - Caching: node_modules, pip, Terraform providers
    - Fail PR on any step failure
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

- [x] 12. GitHub Actions — Deploy pipeline
  - [x] 12.1 Create `.github/workflows/deploy.yml`
    - Trigger: push to develop (staging), push to main (production with approval)
    - Build Docker images, tag with commit SHA + latest, push to ECR
    - Run migrations via one-off ECS Fargate task (advisory lock, halt on failure)
    - Update ECS services with new task definition revision (rolling deploy)
    - Wait for steady state (10min timeout), auto-rollback on failure
    - Frontend: sync to S3 + CloudFront invalidation
    - GitHub Environments: staging (auto), production (required reviewers)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [x] 13. Terraform validation
  - [x] 13.1 Verify all modules pass `terraform fmt -check` and `terraform validate`
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [x] 14. Final checkpoint — Review all infrastructure files
  - Ensure all Dockerfiles, Terraform modules, environment configs, and GitHub Actions workflows are complete and consistent.

## Notes

- This module produces infrastructure configuration files only — no application code changes
- Terraform modules are reusable across environments via variable overrides
- All sensitive values go through Secrets Manager, never hardcoded
- Docker images are built in CI and pushed to ECR — no local builds needed for deployment
- The scraper already has a Dockerfile and docker-compose.yml in `packages/scraper/` — the root-level files supersede those for the full-stack deployment
- Terraform state bootstrap (creating the S3 bucket and DynamoDB table for state) is a one-time manual step documented in the README
