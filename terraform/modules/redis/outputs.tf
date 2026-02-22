output "primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "port" {
  value = 6379
}

output "secret_arn" {
  value = aws_secretsmanager_secret.redis.arn
}
