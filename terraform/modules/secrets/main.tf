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

resource "random_password" "encryption_master_key" {
  length  = 64
  special = false
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
  secret_string = random_password.encryption_master_key.result
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
