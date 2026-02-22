locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "aurora"
  })
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-aurora"
  subnet_ids = var.private_subnet_ids
  tags       = merge(local.common_tags, { Name = "${var.project}-${var.environment}-aurora-subnet-group" })
}

resource "aws_rds_cluster_parameter_group" "main" {
  name   = "${var.project}-${var.environment}-aurora-pg15"
  family = "aurora-postgresql15"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = local.common_tags
}

resource "random_password" "aurora" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "aurora" {
  name = "${var.project}/${var.environment}/aurora-credentials"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "aurora" {
  secret_id = aws_secretsmanager_secret.aurora.id
  secret_string = jsonencode({
    username = "morket"
    password = random_password.aurora.result
    host     = aws_rds_cluster.main.endpoint
    port     = 5432
    dbname   = "morket"
  })
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${var.project}-${var.environment}"
  engine             = "aurora-postgresql"
  engine_version     = var.engine_version
  database_name      = "morket"
  master_username    = "morket"
  master_password    = random_password.aurora.result

  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [var.security_group_id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.main.name

  storage_encrypted   = true
  deletion_protection = var.deletion_protection

  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.preferred_backup_window

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.project}-${var.environment}-final" : null

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-aurora" })
}

resource "aws_rds_cluster_instance" "writer" {
  identifier         = "${var.project}-${var.environment}-writer"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = var.instance_class
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-aurora-writer" })
}

resource "aws_rds_cluster_instance" "reader" {
  count              = var.reader_count
  identifier         = "${var.project}-${var.environment}-reader-${count.index}"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = var.instance_class
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-aurora-reader-${count.index}" })
}
