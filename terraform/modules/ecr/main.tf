locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "ecr"
  })
}

resource "aws_ecr_repository" "repos" {
  for_each = toset(var.repositories)

  name                 = each.value
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }

  tags = merge(local.common_tags, { Name = each.value })
}

resource "aws_ecr_lifecycle_policy" "repos" {
  for_each   = toset(var.repositories)
  repository = aws_ecr_repository.repos[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after ${var.untagged_expiry_days} days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_expiry_days
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Retain only ${var.image_retention_count} tagged images"
        selection = {
          tagStatus   = "tagged"
          tagPrefixList = ["v", "latest"]
          countType   = "imageCountMoreThan"
          countNumber = var.image_retention_count
        }
        action = { type = "expire" }
      }
    ]
  })
}
