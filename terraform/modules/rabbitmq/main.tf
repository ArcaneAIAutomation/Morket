locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "rabbitmq"
  })
}

resource "random_password" "rabbitmq" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "rabbitmq" {
  name = "${var.project}/${var.environment}/rabbitmq-credentials"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "rabbitmq" {
  secret_id = aws_secretsmanager_secret.rabbitmq.id
  secret_string = jsonencode({
    username = "morket"
    password = random_password.rabbitmq.result
  })
}

resource "aws_mq_broker" "main" {
  broker_name = "${var.project}-${var.environment}-rabbitmq"

  engine_type        = "RabbitMQ"
  engine_version     = var.engine_version
  host_instance_type = var.instance_type
  deployment_mode    = var.deployment_mode

  subnet_ids         = var.deployment_mode == "SINGLE_INSTANCE" ? [var.private_subnet_ids[0]] : var.private_subnet_ids
  security_groups    = [var.security_group_id]
  publicly_accessible = false

  user {
    username = "morket"
    password = random_password.rabbitmq.result
  }

  logs {
    general = true
  }

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-rabbitmq" })
}
