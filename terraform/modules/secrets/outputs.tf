output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt_secret.arn
}

output "encryption_master_key_arn" {
  value = aws_secretsmanager_secret.encryption_master_key.arn
}

output "service_api_key_arn" {
  value = aws_secretsmanager_secret.service_api_key.arn
}

output "webhook_hmac_secret_arn" {
  value = aws_secretsmanager_secret.webhook_hmac_secret.arn
}
