variable "project" {
  description = "Project name"
  type        = string
  default     = "morket"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "repositories" {
  description = "List of ECR repository names"
  type        = list(string)
  default     = ["morket-backend", "morket-scraper", "morket-frontend"]
}

variable "image_retention_count" {
  description = "Number of tagged images to retain"
  type        = number
  default     = 20
}

variable "untagged_expiry_days" {
  description = "Days before untagged images expire"
  type        = number
  default     = 7
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
