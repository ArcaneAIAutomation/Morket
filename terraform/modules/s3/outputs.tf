output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.frontend.arn
}

output "frontend_bucket_domain" {
  value = aws_s3_bucket.frontend.bucket_regional_domain_name
}

output "exports_bucket_name" {
  value = aws_s3_bucket.exports.id
}

output "alb_logs_bucket_name" {
  value = aws_s3_bucket.alb_logs.id
}
