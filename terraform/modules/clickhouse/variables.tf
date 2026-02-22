variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "private_subnet_id" {
  description = "Single private subnet ID for the ClickHouse instance"
  type        = string
}

variable "security_group_id" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "m6i.xlarge"
}

variable "ebs_volume_size" {
  type    = number
  default = 500
}

variable "ebs_iops" {
  type    = number
  default = 3000
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "key_pair_name" {
  description = "EC2 key pair for SSH access (optional)"
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
