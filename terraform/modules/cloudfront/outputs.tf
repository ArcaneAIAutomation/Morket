output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "oai_iam_arn" {
  value = aws_cloudfront_origin_access_identity.main.iam_arn
}
