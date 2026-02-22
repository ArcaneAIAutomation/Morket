locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "redis"
  })
}

resource "random_password" "redis_auth" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "redis" {
  name = "${var.project}/${var.environment}/redis-auth"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id     = aws_secretsmanager_secret.redis.id
  secret_string = random_password.redis_auth.result
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_parameter_group" "main" {
  name   = "${var.project}-${var.environment}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.project}-${var.environment}"
  description          = "Morket ${var.environment} Redis cluster"

  node_type            = var.node_type
  engine_version       = var.engine_version
  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.security_group_id]

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.multi_az_enabled
  multi_az_enabled           = var.multi_az_enabled

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  snapshot_retention_limit = var.snapshot_retention_days

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-redis" })
}
