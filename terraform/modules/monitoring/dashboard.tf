resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project}-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# ${var.project} ${var.environment} — Service Dashboard"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 12
        height = 6
        properties = {
          title   = "ECS CPU Utilization"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.backend_service_name, { label = "Backend" }],
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.scraper_service_name, { label = "Scraper" }]
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 1
        width  = 12
        height = 6
        properties = {
          title   = "ECS Memory Utilization"
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.backend_service_name, { label = "Backend" }],
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.scraper_service_name, { label = "Scraper" }]
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 12
        height = 6
        properties = {
          title   = "ALB Request Count & Errors"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, { label = "Requests" }],
            ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { label = "5xx Errors", color = "#d62728" }]
          ]
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 7
        width  = 12
        height = 6
        properties = {
          title   = "ALB Response Time"
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { label = "Avg Response Time" }]
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title   = "Aurora CPU & Connections"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBClusterIdentifier", var.aurora_cluster_identifier, { label = "CPU %" }],
            ["AWS/RDS", "DatabaseConnections", "DBClusterIdentifier", var.aurora_cluster_identifier, { label = "Connections", yAxis = "right" }]
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 13
        width  = 12
        height = 6
        properties = {
          title   = "Redis CPU & Memory"
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", "ReplicationGroupId", var.redis_replication_group_id, { label = "CPU %" }],
            ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "ReplicationGroupId", var.redis_replication_group_id, { label = "Memory %", yAxis = "right" }]
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
        }
      }
    ]
  })
}
