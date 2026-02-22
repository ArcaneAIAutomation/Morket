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
  default = "r6g.large.search"
}

variable "instance_count" {
  type    = number
  default = 2
}

variable "ebs_volume_size" {
  description = "EBS volume size per node in GB"
  type        = number
  default     = 100
}

variable "engine_version" {
  type    = string
  default = "OpenSearch_2.11"
}

variable "snapshot_hour" {
  type    = number
  default = 2
}

variable "tags" {
  type    = map(string)
  default = {}
}
