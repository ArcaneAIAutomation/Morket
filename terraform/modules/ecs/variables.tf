variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  type = string
}

variable "temporal_security_group_id" {
  type = string
}

# --- Backend ---
variable "backend_image" {
  type = string
}

variable "backend_cpu" {
  type    = number
  default = 512
}

variable "backend_memory" {
  type    = number
  default = 1024
}

variable "backend_desired_count" {
  type    = number
  default = 2
}

variable "backend_target_group_arn" {
  type = string
}

variable "backend_env_vars" {
  description = "Non-sensitive environment variables for backend"
  type        = map(string)
  default     = {}
}

variable "backend_secrets" {
  description = "Secrets Manager ARNs for backend"
  type        = map(string)
  default     = {}
}

# --- Scraper ---
variable "scraper_image" {
  type = string
}

variable "scraper_cpu" {
  type    = number
  default = 2048
}

variable "scraper_memory" {
  type    = number
  default = 4096
}

variable "scraper_desired_count" {
  type    = number
  default = 2
}

variable "scraper_target_group_arn" {
  type = string
}

variable "scraper_env_vars" {
  type    = map(string)
  default = {}
}

variable "scraper_secrets" {
  type    = map(string)
  default = {}
}

# --- Temporal Worker ---
variable "temporal_worker_image" {
  type = string
}

variable "temporal_worker_cpu" {
  type    = number
  default = 512
}

variable "temporal_worker_memory" {
  type    = number
  default = 1024
}

variable "temporal_worker_desired_count" {
  type    = number
  default = 1
}

variable "temporal_worker_env_vars" {
  type    = map(string)
  default = {}
}

variable "temporal_worker_secrets" {
  type    = map(string)
  default = {}
}

# --- Temporal Server ---
variable "temporal_server_image" {
  type    = string
  default = "temporalio/auto-setup:1.22"
}

variable "temporal_server_cpu" {
  type    = number
  default = 1024
}

variable "temporal_server_memory" {
  type    = number
  default = 2048
}

variable "temporal_server_env_vars" {
  type    = map(string)
  default = {}
}

variable "temporal_server_secrets" {
  type    = map(string)
  default = {}
}

# --- Auto-scaling ---
variable "enable_autoscaling" {
  type    = bool
  default = false
}

variable "autoscaling_max_capacity" {
  type    = number
  default = 10
}

variable "autoscaling_cpu_target" {
  type    = number
  default = 70
}

# --- Logging ---
variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
