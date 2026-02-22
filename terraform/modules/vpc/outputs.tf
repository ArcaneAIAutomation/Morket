output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "ECS tasks security group ID"
  value       = aws_security_group.ecs.id
}

output "aurora_security_group_id" {
  description = "Aurora security group ID"
  value       = aws_security_group.aurora.id
}

output "redis_security_group_id" {
  description = "Redis security group ID"
  value       = aws_security_group.redis.id
}

output "rabbitmq_security_group_id" {
  description = "RabbitMQ security group ID"
  value       = aws_security_group.rabbitmq.id
}

output "opensearch_security_group_id" {
  description = "OpenSearch security group ID"
  value       = aws_security_group.opensearch.id
}

output "clickhouse_security_group_id" {
  description = "ClickHouse security group ID"
  value       = aws_security_group.clickhouse.id
}

output "temporal_security_group_id" {
  description = "Temporal security group ID"
  value       = aws_security_group.temporal.id
}
