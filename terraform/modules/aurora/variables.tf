variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "engine_version" {
  type    = string
  default = "15.4"
}

variable "reader_count" {
  type    = number
  default = 1
}

variable "backup_retention_period" {
  type    = number
  default = 7
}

variable "preferred_backup_window" {
  type    = string
  default = "03:00-04:00"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "secret_rotation_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
