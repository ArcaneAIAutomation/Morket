locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "monitoring"
  })
}

# --- SNS Topic for Alarms ---

resource "aws_sns_topic" "alarms" {
  name = "${var.project}-${var.environment}-alarms"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- ECS Alarms ---

resource "aws_cloudwatch_metric_alarm" "backend_cpu" {
  alarm_name          = "${var.project}-${var.environment}-backend-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.backend_service_name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "backend_memory" {
  alarm_name          = "${var.project}-${var.environment}-backend-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.backend_service_name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "scraper_cpu" {
  alarm_name          = "${var.project}-${var.environment}-scraper-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.scraper_service_name
  }

  tags = local.common_tags
}

# --- ALB Alarms ---

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-${var.environment}-alb-5xx-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 50
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_response_time" {
  alarm_name          = "${var.project}-${var.environment}-alb-latency-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Average"
  threshold           = 2
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  tags = local.common_tags
}

# --- Aurora Alarms ---

resource "aws_cloudwatch_metric_alarm" "aurora_cpu" {
  alarm_name          = "${var.project}-${var.environment}-aurora-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBClusterIdentifier = var.aurora_cluster_identifier
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "aurora_memory" {
  alarm_name          = "${var.project}-${var.environment}-aurora-memory-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 524288000 # 500 MB
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBClusterIdentifier = var.aurora_cluster_identifier
  }

  tags = local.common_tags
}

# --- Redis Alarm ---

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${var.project}-${var.environment}-redis-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ReplicationGroupId = var.redis_replication_group_id
  }

  tags = local.common_tags
}

# --- Log Metric Filter for Backend Errors ---

resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  name           = "${var.project}-${var.environment}-backend-errors"
  log_group_name = var.backend_log_group_name
  pattern        = "\"level\":\"error\""

  metric_transformation {
    name          = "BackendErrorCount"
    namespace     = "${var.project}/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_error_rate" {
  alarm_name          = "${var.project}-${var.environment}-backend-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BackendErrorCount"
  namespace           = "${var.project}/${var.environment}"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  tags = local.common_tags
}
