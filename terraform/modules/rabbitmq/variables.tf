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

variable "instance_type" {
  type    = string
  default = "mq.m5.large"
}

variable "deployment_mode" {
  description = "SINGLE_INSTANCE or ACTIVE_STANDBY_MULTI_AZ"
  type        = string
  default     = "SINGLE_INSTANCE"
}

variable "engine_version" {
  type    = string
  default = "3.11.20"
}

variable "tags" {
  type    = map(string)
  default = {}
}
