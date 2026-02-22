variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
