locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "cloudfront"
  })
  origin_id = "${var.project}-${var.environment}-frontend"
}

resource "aws_cloudfront_origin_access_identity" "main" {
  comment = "${var.project} ${var.environment} frontend OAI"
}

# Allow CloudFront OAI to read from S3
data "aws_iam_policy_document" "s3_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.frontend_bucket_arn}/*"]
    principals {
      type        = "AWS"
      identifiers = [aws_cloudfront_origin_access_identity.main.iam_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = split(".", var.frontend_bucket_domain)[0]
  policy = data.aws_iam_policy_document.s3_policy.json
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = var.domain_aliases
  price_class         = "PriceClass_100"

  origin {
    domain_name = var.frontend_bucket_domain
    origin_id   = local.origin_id

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    default_ttl = 86400
    max_ttl     = 31536000
    min_ttl     = 0
  }

  # SPA routing: return index.html for 403/404
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-cloudfront" })
}
