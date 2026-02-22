# Design Document — Module 7: Infrastructure & Deployment

## Overview

Module 7 provides the complete infrastructure-as-code, containerization, CI/CD pipelines, and observability configuration needed to deploy all Morket services to AWS. This module produces no application code — it creates Dockerfiles, Terraform modules, GitHub Actions workflows, and supporting configuration files.

The infrastructure follows a standard AWS architecture: ECS Fargate for containerized services, Aurora PostgreSQL for OLTP, ClickHouse on EC2 for OLAP, ElastiCache Redis for caching, Amazon MQ RabbitMQ for messaging, OpenSearch Service for search, S3 + CloudFront for frontend hosting, and Secrets Manager for credential injection.

### Key Design Decisions

1. **ECS Fargate over EKS**: Fargate eliminates cluster management overhead. Morket's services are straightforward containers that don't need Kubernetes-level orchestration. Fargate's per-task billing also fits the variable-load enrichment workloads.

2. **Terraform modules per resource**: Each AWS resource type gets its own reusable Terraform module under `terraform/modules/`. Environment-specific configs in `terraform/environments/{staging,production}/` compose these modules with different variable values.

3. **S3 backend for Terraform state**: Remote state with DynamoDB locking prevents concurrent `terraform apply` conflicts. Separate state files per environment ensure staging changes can't corrupt production state.

4. **One-off ECS tasks for migrations**: Database migrations run as ephemeral Fargate tasks using the backend Docker image with a migration entrypoint. This keeps migrations in the same VPC/security group as the app, uses the same credentials, and avoids needing a bastion host.

5. **GitHub Actions with environment gates**: Staging deploys automatically on `develop` branch pushes. Production deploys require manual approval via GitHub Environments. This balances speed with safety.

6. **Multi-stage Docker builds**: All three services (backend, scraper, frontend) use multi-stage builds to minimize image size. Build artifacts are copied to slim runtime images. Non-root users for security.

7. **CloudFront for SPA hosting**: The React frontend is built to static assets, synced to S3, and served via CloudFront with a custom error response for client-side routing (403/404 → /index.html).

## Architecture

### Infrastructure Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS Account                               │
│                                                                   │
│  ┌─────────────────── VPC (10.0.0.0/16) ───────────────────┐   │
│  │                                                            │   │
│  │  ┌──── Public Subnets ────┐  ┌──── Private Subnets ────┐ │   │
│  │  │  ALB (HTTPS:443)       │  │  ECS Fargate Tasks       │ │   │
│  │  │  NAT Gateway (AZ-a)   │  │    - Backend API (×2)    │ │   │
│  │  │  NAT Gateway (AZ-b)   │  │    - Scraper (×2)        │ │   │
│  │  └────────────────────────┘  │    - Temporal Worker (×1)│ │   │
│  │                               │    - Temporal Server (×1)│ │   │
│  │                               │                          │ │   │
│  │                               │  Aurora PostgreSQL        │ │   │
│  │                               │    - Writer + Reader      │ │   │
│  │                               │  ClickHouse (EC2)         │ │   │
│  │                               │  ElastiCache Redis        │ │   │
│  │                               │  Amazon MQ (RabbitMQ)     │ │   │
│  │                               │  OpenSearch Service        │ │   │
│  │                               └──────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  CloudFront ──► S3 (Frontend Assets)                             │
│  ECR (Docker Images)                                              │
│  Secrets Manager (All Credentials)                                │
│  CloudWatch (Logs, Metrics, Alarms, Dashboard)                   │
│  SNS (Alarm Notifications)                                        │
└───────────────────────────────────────────────────────────────────┘
```

### ALB Routing

```
HTTPS:443
  ├── /api/v1/scrape*  ──► Scraper ECS Service (port 8001)
  ├── /api/v1/*        ──► Backend ECS Service (port 3000)
  └── /*               ──► CloudFront / Frontend
```

### CI/CD Flow

```
PR → ci.yml
  ├── backend changed?  → lint + typecheck + vitest
  ├── scraper changed?  → ruff + black + mypy + pytest
  ├── frontend changed? → lint + typecheck + vitest
  └── terraform changed? → fmt + validate + plan

Merge to develop → deploy.yml → staging
  ├── Build Docker images → push to ECR
  ├── Run migrations (one-off ECS task)
  ├── Update ECS services (rolling deploy)
  ├── Sync frontend to S3 + CloudFront invalidation
  └── Wait for steady state (10min timeout, auto-rollback on failure)

Merge to main → deploy.yml → production (requires approval)
  └── Same steps as staging
```

## File Structure

```
terraform/
├── modules/
│   ├── vpc/              # VPC, subnets, NAT, security groups, flow logs
│   ├── ecs/              # ECS cluster, task defs, services, auto-scaling
│   ├── alb/              # ALB, listeners, target groups, routing rules
│   ├── aurora/           # Aurora PostgreSQL cluster, parameter groups
│   ├── clickhouse/       # EC2 instance, EBS, launch template, backup
│   ├── redis/            # ElastiCache Redis cluster
│   ├── rabbitmq/         # Amazon MQ RabbitMQ broker
│   ├── opensearch/       # OpenSearch Service domain
│   ├── s3/               # S3 buckets (frontend, exports, ALB logs)
│   ├── cloudfront/       # CloudFront distribution + OAI
│   ├── secrets/          # Secrets Manager secrets
│   ├── ecr/              # ECR repositories + lifecycle policies
│   └── monitoring/       # CloudWatch log groups, alarms, dashboard, SNS
├── environments/
│   ├── staging/
│   │   ├── main.tf       # Module composition
│   │   ├── variables.tf  # Variable declarations
│   │   ├── outputs.tf    # Output values
│   │   ├── terraform.tfvars  # Staging-specific values
│   │   ├── backend.tf    # S3 state backend config
│   │   └── versions.tf   # Provider + Terraform version pins
│   └── production/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       ├── terraform.tfvars
│       ├── backend.tf
│       └── versions.tf
│
docker/
├── backend.Dockerfile
├── scraper.Dockerfile
├── frontend.Dockerfile
└── .dockerignore
│
docker-compose.yml          # Root-level local dev compose
│
.github/
├── workflows/
│   ├── ci.yml              # PR checks (lint, test, terraform validate)
│   └── deploy.yml          # Deploy to staging/production
```

## Terraform Module Interfaces

Each module follows the pattern: `variables.tf` (inputs), `main.tf` (resources), `outputs.tf` (outputs).

### Key Module Dependencies

```
vpc ──► ecs (subnets, security groups)
vpc ──► aurora (subnets, security groups)
vpc ──► clickhouse (subnets, security groups)
vpc ──► redis (subnets, security groups)
vpc ──► rabbitmq (subnets, security groups)
vpc ──► opensearch (subnets, security groups)
vpc ──► alb (public subnets, security groups)
ecr ──► ecs (image URIs)
secrets ──► ecs (secret ARNs)
alb ──► ecs (target group ARNs)
aurora ──► secrets (credential rotation)
monitoring ──► ecs (log group names)
s3 ──► cloudfront (bucket domain)
```

## Security Model

- All data stores in private subnets — no public internet access
- ALB is the only public-facing resource (HTTPS only, HTTP redirects)
- Security groups enforce least-privilege: each service can only reach the resources it needs
- Secrets Manager injects credentials at runtime — no env vars in task definitions
- ECR image scanning on push for vulnerability detection
- Non-root Docker users for all services
- VPC Flow Logs for network auditing
- CloudWatch alarms for anomaly detection

## Environment Differences

| Resource | Staging | Production |
|----------|---------|------------|
| Backend ECS | 256 CPU / 512 MB, 1 task | 512 CPU / 1024 MB, 2 tasks |
| Scraper ECS | 1024 CPU / 2048 MB, 1 task | 2048 CPU / 4096 MB, 2 tasks |
| Temporal Worker | 256 CPU / 512 MB, 1 task | 512 CPU / 1024 MB, 1 task |
| Temporal Server | 512 CPU / 1024 MB, 1 task | 1024 CPU / 2048 MB, 1 task |
| Aurora | db.r6g.medium, no reader | db.r6g.large, 1 reader |
| ClickHouse | t3.xlarge, 100 GB | m6i.xlarge, 500 GB |
| Redis | cache.t3.medium, single | cache.r6g.large, multi-AZ |
| RabbitMQ | mq.m5.large, single | mq.m5.large, active/standby |
| OpenSearch | r6g.large.search, 1 node | r6g.large.search, 2 nodes |
| Auto-scaling | Disabled | Enabled (2–10 tasks) |
| NAT Gateways | 1 (single AZ) | 2 (multi-AZ) |
| Deploy gate | Automatic | Manual approval required |
