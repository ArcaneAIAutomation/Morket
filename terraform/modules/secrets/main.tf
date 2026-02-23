locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "secrets"
  })
}

# Application-level secrets (not managed by data store modules)

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_id" "encryption_master_key" {
  byte_length = 32
}

resource "random_password" "service_api_key" {
  length  = 48
  special = false
}

resource "random_password" "webhook_hmac_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "${var.project}/${var.environment}/jwt-secret"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

resource "aws_secretsmanager_secret" "encryption_master_key" {
  name = "${var.project}/${var.environment}/encryption-master-key"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "encryption_master_key" {
  secret_id     = aws_secretsmanager_secret.encryption_master_key.id
  secret_string = random_id.encryption_master_key.hex
}

resource "aws_secretsmanager_secret" "service_api_key" {
  name = "${var.project}/${var.environment}/service-api-key"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "service_api_key" {
  secret_id     = aws_secretsmanager_secret.service_api_key.id
  secret_string = random_password.service_api_key.result
}

resource "aws_secretsmanager_secret" "webhook_hmac_secret" {
  name = "${var.project}/${var.environment}/webhook-hmac-secret"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "webhook_hmac_secret" {
  secret_id     = aws_secretsmanager_secret.webhook_hmac_secret.id
  secret_string = random_password.webhook_hmac_secret.result
}

# Automatic secret rotation (90-day interval)
# Requires a Lambda rotation function to be provisioned separately.
# When rotation_lambda_arn is provided, rotation is enabled for all secrets.

resource "aws_secretsmanager_secret_rotation" "jwt_secret" {
  count               = var.rotation_lambda_arn != "" ? 1 : 0
  secret_id           = aws_secretsmanager_secret.jwt_secret.id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 90
  }
}

resource "aws_secretsmanager_secret_rotation" "encryption_master_key" {
  count               = var.rotation_lambda_arn != "" ? 1 : 0
  secret_id           = aws_secretsmanager_secret.encryption_master_key.id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 90
  }
}

resource "aws_secretsmanager_secret_rotation" "service_api_key" {
  count               = var.rotation_lambda_arn != "" ? 1 : 0
  secret_id           = aws_secretsmanager_secret.service_api_key.id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 90
  }
}

resource "aws_secretsmanager_secret_rotation" "webhook_hmac_secret" {
  count               = var.rotation_lambda_arn != "" ? 1 : 0
  secret_id           = aws_secretsmanager_secret.webhook_hmac_secret.id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 90
  }
}
