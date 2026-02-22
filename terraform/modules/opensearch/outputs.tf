output "domain_endpoint" {
  value = aws_opensearch_domain.main.endpoint
}

output "domain_arn" {
  value = aws_opensearch_domain.main.arn
}

output "secret_arn" {
  value = aws_secretsmanager_secret.opensearch.arn
}
