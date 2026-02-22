output "amqps_endpoint" {
  value = aws_mq_broker.main.instances[0].endpoints[0]
}

output "secret_arn" {
  value = aws_secretsmanager_secret.rabbitmq.arn
}

output "broker_id" {
  value = aws_mq_broker.main.id
}
