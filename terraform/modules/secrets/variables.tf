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

variable "rotation_lambda_arn" {
  description = "ARN of the Lambda function for automatic secret rotation. When provided, enables 90-day rotation for all secrets."
  type        = string
  default     = ""
}
