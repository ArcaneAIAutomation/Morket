data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# --- Networking ---

module "vpc" {
  source = "../../modules/vpc"

  environment        = "staging"
  availability_zones = local.azs
  nat_gateway_count  = 1
  vpc_cidr           = "10.0.0.0/16"
}

# --- ECR ---

module "ecr" {
  source      = "../../modules/ecr"
  environment = "staging"
}

# --- S3 ---

module "s3" {
  source      = "../../modules/s3"
  environment = "staging"
}

# --- ALB ---

module "alb" {
  source = "../../modules/alb"

  environment           = "staging"
  vpc_id                = module.vpc.vpc_id
  public_subnet_ids     = module.vpc.public_subnet_ids
  alb_security_group_id = module.vpc.alb_security_group_id
  acm_certificate_arn   = var.acm_certificate_arn
  access_log_bucket     = module.s3.alb_logs_bucket_name
}

# --- Data Stores ---

module "aurora" {
  source = "../../modules/aurora"

  environment        = "staging"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.aurora_security_group_id
  instance_class     = "db.r6g.medium"
  reader_count       = 0
  deletion_protection = false
}

module "clickhouse" {
  source = "../../modules/clickhouse"

  environment       = "staging"
  private_subnet_id = module.vpc.private_subnet_ids[0]
  security_group_id = module.vpc.clickhouse_security_group_id
  instance_type     = "t3.xlarge"
  ebs_volume_size   = 100
}

module "redis" {
  source = "../../modules/redis"

  environment        = "staging"
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.redis_security_group_id
  node_type          = "cache.t3.medium"
  num_cache_clusters = 1
  multi_az_enabled   = false
}

module "rabbitmq" {
  source = "../../modules/rabbitmq"

  environment        = "staging"
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.rabbitmq_security_group_id
  deployment_mode    = "SINGLE_INSTANCE"
}

module "opensearch" {
  source = "../../modules/opensearch"

  environment        = "staging"
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.opensearch_security_group_id
  instance_count     = 1
  ebs_volume_size    = 50
}

# --- Secrets ---

module "secrets" {
  source      = "../../modules/secrets"
  environment = "staging"
}

# --- CloudFront ---

module "cloudfront" {
  source = "../../modules/cloudfront"

  environment            = "staging"
  frontend_bucket_domain = module.s3.frontend_bucket_domain
  frontend_bucket_arn    = module.s3.frontend_bucket_arn
  acm_certificate_arn    = var.acm_certificate_arn_cloudfront
  domain_aliases         = ["staging.morket.io"]
}

# --- ECS ---

module "ecs" {
  source = "../../modules/ecs"

  environment           = "staging"
  private_subnet_ids    = module.vpc.private_subnet_ids
  ecs_security_group_id = module.vpc.ecs_security_group_id
  temporal_security_group_id = module.vpc.temporal_security_group_id

  # Backend
  backend_image            = "${module.ecr.repository_urls["morket-backend"]}:latest"
  backend_cpu              = 256
  backend_memory           = 512
  backend_desired_count    = 1
  backend_target_group_arn = module.alb.backend_target_group_arn
  backend_env_vars = {
    NODE_ENV           = "staging"
    PORT               = "3000"
    LOG_LEVEL          = "info"
    CORS_ORIGIN        = "https://staging.morket.io"
    TEMPORAL_ADDRESS   = "temporal.morket.local:7233"
    CLICKHOUSE_URL     = "http://${module.clickhouse.private_ip}:8123"
    REDIS_URL          = "rediss://${module.redis.primary_endpoint}:6379"
    OPENSEARCH_NODE_URLS = "https://${module.opensearch.domain_endpoint}"
  }
  backend_secrets = {
    DATABASE_URL          = module.aurora.secret_arn
    JWT_SECRET            = module.secrets.jwt_secret_arn
    ENCRYPTION_MASTER_KEY = module.secrets.encryption_master_key_arn
    SERVICE_API_KEY       = module.secrets.service_api_key_arn
    WEBHOOK_HMAC_SECRET   = module.secrets.webhook_hmac_secret_arn
  }

  # Scraper
  scraper_image            = "${module.ecr.repository_urls["morket-scraper"]}:latest"
  scraper_cpu              = 1024
  scraper_memory           = 2048
  scraper_desired_count    = 1
  scraper_target_group_arn = module.alb.scraper_target_group_arn
  scraper_env_vars = {
    BACKEND_API_URL   = "http://morket-staging-backend.morket.local:3000"
    BROWSER_POOL_SIZE = "3"
    LOG_LEVEL         = "info"
    PORT              = "8001"
  }
  scraper_secrets = {
    SERVICE_API_KEY = module.secrets.service_api_key_arn
  }

  # Temporal Worker
  temporal_worker_image         = "${module.ecr.repository_urls["morket-backend"]}:latest"
  temporal_worker_cpu           = 256
  temporal_worker_memory        = 512
  temporal_worker_desired_count = 1
  temporal_worker_env_vars = {
    TEMPORAL_ADDRESS = "temporal.morket.local:7233"
    NODE_ENV         = "staging"
  }
  temporal_worker_secrets = {
    DATABASE_URL = module.aurora.secret_arn
  }

  # Temporal Server
  temporal_server_env_vars = {
    DB             = "postgresql"
    DB_PORT        = "5432"
    POSTGRES_SEEDS = module.aurora.cluster_endpoint
  }
  temporal_server_secrets = {
    POSTGRES_USER = module.aurora.secret_arn
    POSTGRES_PWD  = module.aurora.secret_arn
  }

  # No auto-scaling in staging
  enable_autoscaling = false
  log_retention_days = 14
}

# --- Monitoring ---

module "monitoring" {
  source = "../../modules/monitoring"

  environment                = "staging"
  ecs_cluster_name           = module.ecs.cluster_name
  backend_service_name       = module.ecs.backend_service_name
  scraper_service_name       = module.ecs.scraper_service_name
  backend_log_group_name     = module.ecs.backend_log_group_name
  alb_arn_suffix             = module.alb.alb_arn
  aurora_cluster_identifier  = module.aurora.cluster_identifier
  redis_replication_group_id = "morket-staging"
  alarm_email                = var.alarm_email
}
