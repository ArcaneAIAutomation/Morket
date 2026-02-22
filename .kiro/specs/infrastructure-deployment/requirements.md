# Requirements Document

## Introduction

Module 7 implements the infrastructure deployment layer for the Morket GTM data engine. This module provides the complete infrastructure-as-code, containerization, and CI/CD pipeline definitions needed to deploy all Morket services to AWS. The module covers five major areas: (1) Docker containerization for the backend Express.js API, the Python/FastAPI scraper service, and the React frontend, (2) Terraform IaC modules for provisioning AWS resources including ECS Fargate for containerized services, Aurora PostgreSQL for OLTP, ClickHouse on EC2 for OLAP, ElastiCache Redis for caching, Amazon MQ (RabbitMQ) for message queuing, OpenSearch Service for full-text search, S3 for static assets, and supporting networking/security infrastructure, (3) GitHub Actions CI/CD pipelines for automated testing, building, and deploying across staging and production environments, (4) secrets management using AWS Secrets Manager integrated with ECS task definitions, and (5) observability infrastructure including CloudWatch logging, alarms, and dashboards. The module ensures that all services are deployed with proper network isolation, auto-scaling, health checks, and zero-downtime deployment strategies.

## Glossary

- **Deployment_Pipeline**: The GitHub Actions CI/CD workflow that automates testing, Docker image building, ECR publishing, and ECS service deployment for each Morket service.
- **Terraform_Module**: A reusable Terraform configuration unit that provisions a specific AWS resource or group of related resources with configurable inputs and outputs.
- **ECS_Cluster**: The AWS ECS cluster running on Fargate that hosts the backend API, scraper service, and Temporal worker as containerized tasks.
- **ECS_Service**: An ECS service definition that maintains a desired count of running task instances for a specific Morket service, with load balancer integration and health checks.
- **ECS_Task_Definition**: An ECS task definition specifying the Docker image, CPU/memory limits, environment variables, secrets references, log configuration, and health check for a Morket service container.
- **ECR_Repository**: An AWS Elastic Container Registry repository that stores Docker images for each Morket service.
- **ALB**: An AWS Application Load Balancer that routes incoming HTTPS traffic to the appropriate ECS service based on path-based routing rules.
- **VPC**: The AWS Virtual Private Cloud providing network isolation with public subnets (ALB, NAT Gateway), private subnets (ECS tasks, databases), and security groups.
- **Aurora_Cluster**: An Amazon Aurora PostgreSQL-compatible database cluster providing the OLTP data store with multi-AZ failover and automated backups.
- **ClickHouse_Instance**: An EC2 instance running ClickHouse server for OLAP analytics queries, deployed in a private subnet with EBS storage.
- **Redis_Cluster**: An Amazon ElastiCache Redis cluster providing in-memory caching for session data, workspace configs, and analytics query results.
- **RabbitMQ_Broker**: An Amazon MQ broker running RabbitMQ for asynchronous message queuing between services.
- **OpenSearch_Domain**: An Amazon OpenSearch Service domain providing full-text search capabilities for workspace data.
- **S3_Bucket**: An AWS S3 bucket used for storing the React frontend static assets, CSV exports, and other file storage needs.
- **CloudFront_Distribution**: An AWS CloudFront CDN distribution serving the React frontend static assets from S3 with HTTPS and caching.
- **Secrets_Manager**: AWS Secrets Manager used to store and rotate sensitive configuration values (database credentials, API keys, JWT secrets, encryption keys) injected into ECS tasks at runtime.
- **CloudWatch_Dashboard**: An AWS CloudWatch dashboard aggregating metrics, logs, and alarms for all Morket services into a single monitoring view.
- **Temporal_Server**: The Temporal.io server deployed as an ECS service that orchestrates durable enrichment workflows, backed by the Aurora PostgreSQL database.

## Requirements

### Requirement 1: Docker Containerization for All Services

**User Story:** As a DevOps engineer, I want all Morket services containerized with production-ready Dockerfiles, so that services can be built, tested, and deployed consistently across environments.

#### Acceptance Criteria

1. THE Deployment_Pipeline SHALL provide a Dockerfile for the backend Express.js API using a multi-stage build based on Node.js 20 LTS Alpine, with a build stage that compiles TypeScript and a production stage that copies only compiled JavaScript and production dependencies
2. THE Deployment_Pipeline SHALL provide a Dockerfile for the scraper FastAPI service using a multi-stage build based on Python 3.11-slim, installing Playwright and Chromium dependencies, with resource-aware defaults (Chromium flags: --no-sandbox, --disable-dev-shm-usage, --disable-gpu)
3. THE Deployment_Pipeline SHALL provide a Dockerfile for the React frontend using a multi-stage build based on Node.js 20 LTS Alpine, with a build stage that runs `npm run build` and a production stage that serves static assets via Nginx Alpine
4. EACH Dockerfile SHALL include a HEALTHCHECK instruction that verifies the service is responding (HTTP GET /health for backend and scraper, HTTP GET / for frontend Nginx)
5. EACH Dockerfile SHALL define a non-root USER for the runtime stage to follow the principle of least privilege
6. EACH Dockerfile SHALL use `.dockerignore` files to exclude node_modules, .git, test files, and local environment files from the build context
7. THE Deployment_Pipeline SHALL provide a docker-compose.yml at the repository root that defines all services (backend, scraper, frontend, PostgreSQL, ClickHouse, Redis, RabbitMQ, OpenSearch, Temporal) for local development with proper networking and volume mounts

### Requirement 2: AWS VPC and Network Architecture

**User Story:** As a DevOps engineer, I want a secure VPC with proper network segmentation, so that Morket services are isolated from the public internet and communicate securely.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision a VPC with a configurable CIDR block (default 10.0.0.0/16) across 2 availability zones for high availability
2. THE Terraform_Module SHALL provision public subnets (one per AZ) for the ALB and NAT Gateways, and private subnets (one per AZ) for ECS tasks, databases, and caches
3. THE Terraform_Module SHALL provision NAT Gateways (one per AZ) in the public subnets to allow private subnet resources to access the internet for outbound connections (external API calls, proxy rotation)
4. THE Terraform_Module SHALL provision security groups with the following rules: ALB accepts inbound HTTPS (443) from 0.0.0.0/0; ECS tasks accept inbound traffic only from the ALB security group on service ports; Aurora accepts inbound PostgreSQL (5432) only from the ECS security group; Redis accepts inbound (6379) only from the ECS security group; RabbitMQ accepts inbound (5671) only from the ECS security group; OpenSearch accepts inbound (443) only from the ECS security group; ClickHouse accepts inbound (8123, 9000) only from the ECS security group
5. THE Terraform_Module SHALL provision VPC Flow Logs to CloudWatch for network traffic auditing
6. THE Terraform_Module SHALL tag all resources with configurable tags including `Project: morket`, `Environment: {env}`, and `Module: infrastructure`

### Requirement 3: ECS Fargate Cluster and Service Definitions

**User Story:** As a DevOps engineer, I want Morket services running on ECS Fargate with auto-scaling and health checks, so that services scale with demand and recover from failures automatically.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an ECS cluster with Fargate capacity providers and container insights enabled
2. THE Terraform_Module SHALL define an ECS_Task_Definition for the backend API with configurable CPU (default 512 units) and memory (default 1024 MB), referencing the backend ECR image, environment variables from Terraform variables, and secrets from Secrets_Manager ARNs
3. THE Terraform_Module SHALL define an ECS_Task_Definition for the scraper service with configurable CPU (default 2048 units) and memory (default 4096 MB) to accommodate Chromium browser instances, referencing the scraper ECR image
4. THE Terraform_Module SHALL define an ECS_Task_Definition for the Temporal worker with configurable CPU (default 512 units) and memory (default 1024 MB), running the same backend image with a different entrypoint command for the Temporal worker process
5. THE Terraform_Module SHALL define an ECS_Service for each task definition with a desired count (default 2 for backend, 2 for scraper, 1 for Temporal worker), deployment minimum healthy percent of 100%, and deployment maximum percent of 200% for zero-downtime rolling deployments
6. EACH ECS_Service SHALL configure an ALB target group health check on the /health endpoint with a health check interval of 30 seconds, healthy threshold of 2, and unhealthy threshold of 3
7. THE Terraform_Module SHALL configure ECS service auto-scaling for the backend and scraper services based on CPU utilization (scale up at 70%, scale down at 30%) with a minimum of 2 tasks and a configurable maximum (default 10)
8. EACH ECS_Task_Definition SHALL configure CloudWatch Logs as the log driver with a log group per service and a configurable retention period (default 30 days)

### Requirement 4: Application Load Balancer and Routing

**User Story:** As a DevOps engineer, I want an ALB that routes traffic to the correct service based on URL path, so that a single entry point serves the frontend, backend API, and scraper API.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an ALB in the public subnets with an HTTPS listener on port 443 using an ACM certificate for the configured domain name
2. THE Terraform_Module SHALL provision an HTTP listener on port 80 that redirects all traffic to HTTPS
3. THE ALB SHALL route requests matching `/api/v1/scrape*` to the scraper ECS_Service target group
4. THE ALB SHALL route requests matching `/api/v1/*` to the backend ECS_Service target group
5. THE ALB SHALL route all remaining requests to the CloudFront_Distribution origin (or a default target group serving the frontend) as the default action
6. THE Terraform_Module SHALL configure ALB access logs to an S3 bucket with a lifecycle policy that expires logs after 90 days
7. THE ALB SHALL enforce a request timeout of 120 seconds to accommodate long-running enrichment and scraping API calls

### Requirement 5: Aurora PostgreSQL Database

**User Story:** As a DevOps engineer, I want a managed Aurora PostgreSQL cluster with multi-AZ failover and automated backups, so that the OLTP database is highly available and durable.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an Aurora PostgreSQL-compatible cluster (engine version 15.x) with a writer instance and one reader replica across different availability zones
2. THE Terraform_Module SHALL configure the Aurora cluster with configurable instance class (default db.r6g.large), storage encryption enabled using the default AWS KMS key, and deletion protection enabled for production environments
3. THE Terraform_Module SHALL configure automated backups with a configurable retention period (default 7 days) and a preferred backup window during off-peak hours
4. THE Terraform_Module SHALL store the database master credentials in Secrets_Manager with automatic rotation enabled (default 30-day rotation interval)
5. THE Terraform_Module SHALL configure the Aurora cluster parameter group with `shared_preload_libraries = 'pg_stat_statements'` for query performance monitoring and `log_min_duration_statement = 1000` to log slow queries exceeding 1 second
6. THE Terraform_Module SHALL provision the Aurora cluster in private subnets with a DB subnet group and a security group allowing inbound connections only from the ECS security group on port 5432
7. THE Terraform_Module SHALL output the Aurora cluster endpoint, reader endpoint, and Secrets_Manager secret ARN for use by ECS task definitions

### Requirement 6: ClickHouse OLAP Instance

**User Story:** As a DevOps engineer, I want a ClickHouse server deployed on EC2 with persistent storage, so that the OLAP analytics layer has a dedicated high-performance analytical database.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an EC2 instance (configurable instance type, default m6i.xlarge) in a private subnet running ClickHouse server installed via the official ClickHouse repository
2. THE Terraform_Module SHALL attach an EBS gp3 volume (configurable size, default 500 GB, configurable IOPS default 3000) to the EC2 instance for ClickHouse data storage, mounted at /var/lib/clickhouse
3. THE Terraform_Module SHALL configure the ClickHouse instance with a security group allowing inbound HTTP (8123) and native protocol (9000) connections only from the ECS security group
4. THE Terraform_Module SHALL provision the EC2 instance using a launch template with user data that installs ClickHouse, configures the server settings (max_memory_usage, max_threads), and starts the service
5. THE Terraform_Module SHALL configure automated EBS snapshots via AWS Backup with a configurable retention period (default 7 days) for disaster recovery
6. THE Terraform_Module SHALL store the ClickHouse admin credentials in Secrets_Manager
7. THE Terraform_Module SHALL output the ClickHouse private IP address and port for use by ECS task definitions

### Requirement 7: ElastiCache Redis Cluster

**User Story:** As a DevOps engineer, I want a managed Redis cluster for caching and session storage, so that frequently accessed data is served with low latency.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an ElastiCache Redis cluster (engine version 7.x) with a configurable node type (default cache.r6g.large) and a single-node replication group with automatic failover disabled for staging, or a multi-node replication group with automatic failover enabled for production
2. THE Terraform_Module SHALL configure the Redis cluster in private subnets with a cache subnet group and a security group allowing inbound connections only from the ECS security group on port 6379
3. THE Terraform_Module SHALL enable encryption at rest using the default AWS KMS key and encryption in transit (TLS) for the Redis cluster
4. THE Terraform_Module SHALL configure the Redis parameter group with `maxmemory-policy = allkeys-lru` for cache eviction
5. THE Terraform_Module SHALL configure automated snapshots with a configurable retention period (default 3 days)
6. THE Terraform_Module SHALL store the Redis AUTH token in Secrets_Manager
7. THE Terraform_Module SHALL output the Redis primary endpoint and port for use by ECS task definitions

### Requirement 8: Amazon MQ RabbitMQ Broker

**User Story:** As a DevOps engineer, I want a managed RabbitMQ broker for asynchronous message queuing, so that services can communicate reliably via message queues.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an Amazon MQ broker running RabbitMQ (engine version 3.11.x) with a configurable instance type (default mq.m5.large) and single-instance deployment for staging or active/standby deployment for production
2. THE Terraform_Module SHALL configure the RabbitMQ broker in private subnets with a security group allowing inbound AMQPS (5671) connections only from the ECS security group
3. THE Terraform_Module SHALL enable CloudWatch logging for the RabbitMQ broker with general and audit log types
4. THE Terraform_Module SHALL store the RabbitMQ admin credentials in Secrets_Manager
5. THE Terraform_Module SHALL output the RabbitMQ broker AMQPS endpoint and Secrets_Manager secret ARN for use by ECS task definitions

### Requirement 9: Amazon OpenSearch Service Domain

**User Story:** As a DevOps engineer, I want a managed OpenSearch domain for full-text search, so that the search layer has a scalable and reliable search engine.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an Amazon OpenSearch Service domain (engine version OpenSearch 2.x) with configurable instance type (default r6g.large.search) and instance count (default 2 for multi-AZ)
2. THE Terraform_Module SHALL configure the OpenSearch domain with EBS storage (gp3, configurable size default 100 GB per node) and encryption at rest using the default AWS KMS key
3. THE Terraform_Module SHALL configure the OpenSearch domain with node-to-node encryption enabled and HTTPS enforcement for all traffic
4. THE Terraform_Module SHALL configure the OpenSearch domain access policy to allow connections only from the ECS security group within the VPC
5. THE Terraform_Module SHALL configure automated snapshots for the OpenSearch domain with a configurable snapshot hour (default 02:00 UTC)
6. THE Terraform_Module SHALL store the OpenSearch master user credentials in Secrets_Manager
7. THE Terraform_Module SHALL output the OpenSearch domain endpoint and Secrets_Manager secret ARN for use by ECS task definitions

### Requirement 10: S3 and CloudFront for Frontend Hosting

**User Story:** As a DevOps engineer, I want the React frontend served from S3 via CloudFront, so that static assets are delivered globally with low latency and high availability.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision an S3 bucket for frontend static assets with versioning enabled, server-side encryption (AES-256), and public access blocked
2. THE Terraform_Module SHALL provision a CloudFront distribution with the S3 bucket as the origin, using an Origin Access Identity (OAI) to restrict direct S3 access
3. THE CloudFront_Distribution SHALL use the ACM certificate for the configured domain name and enforce HTTPS-only viewer connections
4. THE CloudFront_Distribution SHALL configure a custom error response that returns `/index.html` with a 200 status code for 403 and 404 errors to support client-side routing in the React SPA
5. THE CloudFront_Distribution SHALL configure cache behaviors with a default TTL of 86400 seconds (1 day) for static assets and a TTL of 0 for `/index.html` to ensure users always receive the latest application version
6. THE Terraform_Module SHALL provision a separate S3 bucket for CSV exports and file storage with lifecycle rules that transition objects to S3 Glacier after 90 days and expire after 365 days
7. THE Terraform_Module SHALL output the CloudFront distribution domain name and the S3 bucket names for use by the Deployment_Pipeline

### Requirement 11: AWS Secrets Manager Integration

**User Story:** As a DevOps engineer, I want all sensitive configuration values stored in AWS Secrets Manager and injected into ECS tasks at runtime, so that secrets are never committed to source control or exposed in environment variables.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision Secrets_Manager secrets for: database credentials (Aurora master password), ClickHouse admin credentials, Redis AUTH token, RabbitMQ admin credentials, OpenSearch master user credentials, JWT signing secret, AES-256-GCM encryption master key, service-to-service API key (X-Service-Key), and webhook HMAC signing secret
2. EACH ECS_Task_Definition SHALL reference Secrets_Manager secret ARNs in the `secrets` block rather than passing sensitive values as plaintext environment variables
3. THE Terraform_Module SHALL configure IAM task execution roles for each ECS service with permissions to read only the specific Secrets_Manager secrets required by that service
4. THE Terraform_Module SHALL enable automatic rotation for the Aurora database credentials with a configurable rotation interval (default 30 days) using a Lambda rotation function
5. IF a Secrets_Manager secret is rotated, THEN THE ECS_Service SHALL pick up the new secret value on the next task launch without requiring a redeployment
6. THE Terraform_Module SHALL tag all Secrets_Manager secrets with `Project: morket` and `Environment: {env}` for cost allocation and access auditing

### Requirement 12: Temporal.io Server Deployment

**User Story:** As a DevOps engineer, I want Temporal.io deployed as a managed ECS service backed by Aurora PostgreSQL, so that durable enrichment workflows execute reliably in production.

#### Acceptance Criteria

1. THE Terraform_Module SHALL define an ECS_Task_Definition for the Temporal server using the official `temporalio/auto-setup` Docker image with configurable CPU (default 1024 units) and memory (default 2048 MB)
2. THE Temporal_Server ECS_Task_Definition SHALL configure environment variables pointing to the Aurora PostgreSQL cluster endpoint for Temporal's persistence store and visibility store
3. THE Terraform_Module SHALL define an ECS_Service for the Temporal server with a desired count of 1, a service discovery namespace entry for internal DNS resolution (temporal.morket.local), and a health check on the Temporal frontend gRPC port (7233)
4. THE Terraform_Module SHALL configure a security group for the Temporal server allowing inbound gRPC (7233) connections only from the ECS security group (backend and Temporal worker tasks)
5. THE Terraform_Module SHALL configure the Temporal server to use the Aurora cluster as its persistence backend, with the database name `temporal` and credentials from Secrets_Manager
6. THE Terraform_Module SHALL output the Temporal server internal DNS endpoint for use by the backend and Temporal worker ECS task definitions

### Requirement 13: GitHub Actions CI/CD Pipeline — Build and Test

**User Story:** As a developer, I want automated CI pipelines that run tests and build Docker images on every pull request, so that code quality is validated before merging.

#### Acceptance Criteria

1. THE Deployment_Pipeline SHALL define a GitHub Actions workflow (`.github/workflows/ci.yml`) that triggers on pull requests targeting the `main` and `develop` branches
2. WHEN a pull request modifies files under `packages/backend/`, THE Deployment_Pipeline SHALL run the backend test suite: lint (ESLint), type check (tsc --noEmit), unit tests (vitest --run), and property-based tests (vitest --run tests/property/)
3. WHEN a pull request modifies files under `packages/scraper/`, THE Deployment_Pipeline SHALL run the scraper test suite: lint (ruff check), format check (black --check), type check (mypy), and unit tests (pytest)
4. WHEN a pull request modifies files under `packages/frontend/`, THE Deployment_Pipeline SHALL run the frontend test suite: lint (ESLint), type check (tsc --noEmit), and unit tests (vitest --run)
5. WHEN a pull request modifies files under `terraform/`, THE Deployment_Pipeline SHALL run Terraform validation: `terraform fmt -check`, `terraform validate`, and `terraform plan` against the staging environment
6. THE Deployment_Pipeline SHALL use GitHub Actions caching for node_modules, pip packages, and Terraform provider plugins to reduce CI execution time
7. THE Deployment_Pipeline SHALL fail the pull request check if any test, lint, or validation step fails

### Requirement 14: GitHub Actions CI/CD Pipeline — Deploy

**User Story:** As a DevOps engineer, I want automated deployment pipelines that build Docker images and deploy to staging and production, so that releases are consistent and repeatable.

#### Acceptance Criteria

1. THE Deployment_Pipeline SHALL define a GitHub Actions workflow (`.github/workflows/deploy.yml`) that triggers on pushes to the `develop` branch (deploy to staging) and on pushes to the `main` branch (deploy to production)
2. WHEN the deploy workflow triggers, THE Deployment_Pipeline SHALL build Docker images for each modified service, tag images with the Git commit SHA and `latest`, and push images to the corresponding ECR_Repository
3. WHEN Docker images are pushed to ECR, THE Deployment_Pipeline SHALL update the ECS_Service to use the new task definition revision referencing the new image tag, triggering a rolling deployment
4. THE Deployment_Pipeline SHALL wait for the ECS deployment to reach a steady state (all tasks healthy) with a configurable timeout (default 10 minutes) before marking the deployment as successful
5. IF the ECS deployment fails to reach a steady state within the timeout, THEN THE Deployment_Pipeline SHALL trigger an automatic rollback to the previous task definition revision and fail the workflow
6. THE Deployment_Pipeline SHALL run database migrations (packages/backend/migrations/) against the target environment's Aurora cluster before deploying the new backend image
7. WHEN deploying the frontend, THE Deployment_Pipeline SHALL sync the built static assets to the S3 bucket and create a CloudFront invalidation for `/*` to clear the CDN cache
8. THE Deployment_Pipeline SHALL use GitHub Actions environments with required reviewers for production deployments, allowing staging deployments to proceed automatically

### Requirement 15: Terraform State Management and Module Structure

**User Story:** As a DevOps engineer, I want Terraform state stored remotely with proper locking and a modular structure, so that infrastructure changes are safe, auditable, and reusable across environments.

#### Acceptance Criteria

1. THE Terraform_Module SHALL use an S3 backend for remote state storage with a DynamoDB table for state locking, configured per environment (staging, production)
2. THE Terraform_Module SHALL organize infrastructure code under `terraform/` with the following structure: `terraform/modules/` for reusable modules (vpc, ecs, aurora, clickhouse, redis, rabbitmq, opensearch, s3, cloudfront, secrets, monitoring), `terraform/environments/staging/` and `terraform/environments/production/` for environment-specific configurations
3. EACH Terraform_Module SHALL define input variables with descriptions, types, and default values, and output values for resource identifiers and endpoints needed by dependent modules
4. THE Terraform_Module SHALL use Terraform workspaces or separate state files per environment to isolate staging and production infrastructure state
5. THE Terraform_Module SHALL define a `terraform/environments/{env}/terraform.tfvars` file per environment with environment-specific variable values (instance sizes, replica counts, domain names)
6. THE Terraform_Module SHALL pin all provider versions and module versions to prevent unexpected changes from upstream updates

### Requirement 16: Observability — CloudWatch Logging, Metrics, and Alarms

**User Story:** As a DevOps engineer, I want centralized logging, metrics, and alarms for all Morket services, so that I can monitor system health and respond to incidents quickly.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision CloudWatch Log Groups for each ECS service (backend, scraper, Temporal server, Temporal worker) with configurable log retention (default 30 days)
2. THE Terraform_Module SHALL provision CloudWatch Alarms for: ECS service CPU utilization exceeding 80%, ECS service memory utilization exceeding 80%, ALB 5xx error rate exceeding 5% over 5 minutes, ALB target response time exceeding 2 seconds, Aurora CPU utilization exceeding 80%, Aurora freeable memory below 500 MB, Redis CPU utilization exceeding 70%, and ClickHouse EC2 instance CPU utilization exceeding 80%
3. THE Terraform_Module SHALL provision an SNS topic for alarm notifications and configure all CloudWatch Alarms to publish to the SNS topic
4. THE Terraform_Module SHALL provision a CloudWatch Dashboard displaying: ECS service task counts and CPU/memory utilization, ALB request count and error rates, Aurora connections and query latency, Redis cache hit rate and memory usage, ClickHouse query count and duration, and OpenSearch cluster health and indexing rate
5. EACH ECS_Task_Definition SHALL configure the awslogs log driver to stream container stdout/stderr to the corresponding CloudWatch Log Group with a configurable log stream prefix
6. THE Terraform_Module SHALL configure CloudWatch Log Metric Filters on the backend log group to track ERROR-level log entries and create an alarm when the error rate exceeds 10 errors per minute

### Requirement 17: ECR Repository Management

**User Story:** As a DevOps engineer, I want ECR repositories for each service with lifecycle policies, so that Docker images are stored securely and old images are cleaned up automatically.

#### Acceptance Criteria

1. THE Terraform_Module SHALL provision ECR repositories for: `morket-backend`, `morket-scraper`, and `morket-frontend`
2. EACH ECR_Repository SHALL have image scanning enabled on push to detect vulnerabilities in Docker images
3. EACH ECR_Repository SHALL have a lifecycle policy that retains the 20 most recent tagged images and expires untagged images older than 7 days
4. EACH ECR_Repository SHALL have encryption enabled using the default AWS KMS key
5. THE Terraform_Module SHALL configure an ECR repository policy allowing the ECS task execution role to pull images
6. THE Terraform_Module SHALL output the ECR repository URLs for use by the Deployment_Pipeline

### Requirement 18: Database Migration Strategy

**User Story:** As a DevOps engineer, I want database migrations executed safely as part of the deployment pipeline, so that schema changes are applied consistently across environments without data loss.

#### Acceptance Criteria

1. THE Deployment_Pipeline SHALL execute PostgreSQL migrations from `packages/backend/migrations/` against the target Aurora cluster before deploying the new backend ECS task definition
2. THE Deployment_Pipeline SHALL execute ClickHouse migrations from `packages/backend/migrations/clickhouse/` against the target ClickHouse instance before deploying the new backend ECS task definition
3. THE Deployment_Pipeline SHALL run migrations using a dedicated ECS task (one-off Fargate task) with the backend Docker image and a migration-specific entrypoint command, using the same VPC and security group as the backend service
4. IF a migration fails, THEN THE Deployment_Pipeline SHALL halt the deployment, log the migration error, and fail the workflow without deploying the new application version
5. THE Deployment_Pipeline SHALL acquire a PostgreSQL advisory lock before running migrations to prevent concurrent migration execution from parallel deployments
6. THE Deployment_Pipeline SHALL log the migration version applied and execution time for audit purposes

### Requirement 19: Environment Configuration and Variable Management

**User Story:** As a DevOps engineer, I want environment-specific configuration managed through Terraform variables and Secrets Manager, so that the same Docker images can be deployed to staging and production with different configurations.

#### Acceptance Criteria

1. THE Terraform_Module SHALL define environment-specific variables for: domain name, instance sizes (ECS CPU/memory, Aurora instance class, Redis node type, ClickHouse instance type), replica counts (ECS desired count, Aurora reader count), auto-scaling limits, and log retention periods
2. THE Terraform_Module SHALL pass non-sensitive environment variables (API URLs, feature flags, log levels, rate limit values) to ECS task definitions via the `environment` block in the container definition
3. THE Terraform_Module SHALL pass sensitive environment variables (database URLs with credentials, API keys, JWT secrets, encryption keys) to ECS task definitions via the `secrets` block referencing Secrets_Manager ARNs
4. THE Terraform_Module SHALL define a staging environment with reduced instance sizes (backend: 256 CPU/512 MB, scraper: 1024 CPU/2048 MB, Aurora: db.r6g.medium, Redis: cache.t3.medium) and single-AZ deployments to minimize cost
5. THE Terraform_Module SHALL define a production environment with full instance sizes, multi-AZ deployments, and auto-scaling enabled for all applicable services
6. THE Terraform_Module SHALL configure the backend ECS task with environment variables for: `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `OPENSEARCH_URL`, `TEMPORAL_ADDRESS`, `JWT_SECRET`, `ENCRYPTION_MASTER_KEY`, `SERVICE_API_KEY`, `WEBHOOK_HMAC_SECRET`, `NODE_ENV`, `LOG_LEVEL`, and `PORT`
7. THE Terraform_Module SHALL configure the scraper ECS task with environment variables for: `BACKEND_API_URL`, `SERVICE_API_KEY`, `PROXY_URLS`, `BROWSER_POOL_SIZE`, `LOG_LEVEL`, and `PORT`

### Requirement 20: Terraform Configuration Round-Trip Validation

**User Story:** As a DevOps engineer, I want Terraform configurations to be validated for correctness, so that infrastructure changes are safe and predictable.

#### Acceptance Criteria

1. FOR ALL Terraform module configurations, running `terraform fmt` followed by `terraform validate` SHALL produce zero errors (format and syntax round-trip property)
2. FOR ALL Terraform environment configurations, running `terraform plan` SHALL produce a valid execution plan without errors
3. THE Terraform_Module SHALL define output values for all resource endpoints and identifiers that are consumed by other modules, ensuring that module composition is validated at plan time
4. EACH Terraform_Module SHALL include a `versions.tf` file pinning the required Terraform version (>= 1.5.0) and all provider versions to specific minor versions
