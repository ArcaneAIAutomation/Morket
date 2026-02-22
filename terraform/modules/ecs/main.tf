locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "ecs"
  })
}

# --- ECS Cluster ---

resource "aws_ecs_cluster" "main" {
  name = "${var.project}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# --- IAM Roles ---

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project}-${var.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["secretsmanager:GetSecretValue"]
      Effect   = "Allow"
      Resource = "*"
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.project}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

# --- CloudWatch Log Groups ---

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.project}-${var.environment}/backend"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "scraper" {
  name              = "/ecs/${var.project}-${var.environment}/scraper"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "temporal_worker" {
  name              = "/ecs/${var.project}-${var.environment}/temporal-worker"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "temporal_server" {
  name              = "/ecs/${var.project}-${var.environment}/temporal-server"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}
