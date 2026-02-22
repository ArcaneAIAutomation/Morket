variable "project" {
  description = "Project name for resource tagging"
  type        = string
  default     = "morket"
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
}

variable "nat_gateway_count" {
  description = "Number of NAT gateways (1 for staging, 2 for production)"
  type        = number
  default     = 1
}

variable "enable_flow_logs" {
  description = "Enable VPC flow logs"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
