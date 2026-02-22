output "private_ip" {
  value = aws_instance.clickhouse.private_ip
}

output "http_port" {
  value = 8123
}

output "native_port" {
  value = 9000
}

output "secret_arn" {
  value = aws_secretsmanager_secret.clickhouse.arn
}
