variable "project" {
  type    = string
  default = "morket"
}

variable "environment" {
  type = string
}

variable "frontend_bucket_domain" {
  description = "S3 bucket regional domain name for frontend assets"
  type        = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (must be in us-east-1 for CloudFront)"
  type        = string
}

variable "domain_aliases" {
  description = "Custom domain aliases for the distribution"
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
