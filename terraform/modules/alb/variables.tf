variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID for ALB"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "access_log_bucket" {
  description = "S3 bucket name for ALB access logs"
  type        = string
  default     = ""
}

variable "request_timeout" {
  description = "ALB request timeout in seconds"
  type        = number
  default     = 120
}

variable "tags" {
  type    = map(string)
  default = {}
}
