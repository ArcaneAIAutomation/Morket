variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "domain_name" {
  type = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "acm_certificate_arn_cloudfront" {
  description = "ACM certificate ARN in us-east-1 for CloudFront"
  type        = string
}

variable "alarm_email" {
  type    = string
  default = ""
}
