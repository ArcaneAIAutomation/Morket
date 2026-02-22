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

variable "security_group_id" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.r6g.large"
}

variable "engine_version" {
  type    = string
  default = "7.0"
}

variable "multi_az_enabled" {
  type    = bool
  default = false
}

variable "num_cache_clusters" {
  description = "1 for staging, 2+ for production with failover"
  type        = number
  default     = 1
}

variable "snapshot_retention_days" {
  type    = number
  default = 3
}

variable "tags" {
  type    = map(string)
  default = {}
}
