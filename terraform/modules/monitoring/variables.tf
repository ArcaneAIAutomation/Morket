variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "backend_service_name" {
  type = string
}

variable "scraper_service_name" {
  type = string
}

variable "backend_log_group_name" {
  type = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for CloudWatch metrics"
  type        = string
}

variable "aurora_cluster_identifier" {
  type = string
}

variable "redis_replication_group_id" {
  type = string
}

variable "clickhouse_instance_id" {
  type    = string
  default = ""
}

variable "opensearch_domain_name" {
  type    = string
  default = ""
}

variable "alarm_email" {
  description = "Email for alarm notifications (optional)"
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
