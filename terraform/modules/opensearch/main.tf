locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "opensearch"
  })
}

resource "random_password" "opensearch" {
  length  = 32
  special = true
  override_special = "!@#$%^&*"
}

resource "aws_secretsmanager_secret" "opensearch" {
  name = "${var.project}/${var.environment}/opensearch-credentials"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "opensearch" {
  secret_id = aws_secretsmanager_secret.opensearch.id
  secret_string = jsonencode({
    username = "morket"
    password = random_password.opensearch.result
  })
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_opensearch_domain" "main" {
  domain_name    = "${var.project}-${var.environment}"
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = var.instance_count
    zone_awareness_enabled = var.instance_count > 1

    dynamic "zone_awareness_config" {
      for_each = var.instance_count > 1 ? [1] : []
      content {
        availability_zone_count = min(var.instance_count, length(var.private_subnet_ids))
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.ebs_volume_size
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  vpc_options {
    subnet_ids         = slice(var.private_subnet_ids, 0, min(var.instance_count, length(var.private_subnet_ids)))
    security_group_ids = [var.security_group_id]
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = "morket"
      master_user_password = random_password.opensearch.result
    }
  }

  snapshot_options {
    automated_snapshot_start_hour = var.snapshot_hour
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "es:*"
      Resource  = "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${var.project}-${var.environment}/*"
    }]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-opensearch" })
}
