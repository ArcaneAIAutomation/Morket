output "cluster_id" {
  value = aws_ecs_cluster.main.id
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "backend_service_name" {
  value = aws_ecs_service.backend.name
}

output "scraper_service_name" {
  value = aws_ecs_service.scraper.name
}

output "temporal_worker_service_name" {
  value = aws_ecs_service.temporal_worker.name
}

output "temporal_server_endpoint" {
  description = "Temporal server internal DNS endpoint"
  value       = "temporal.${var.project}.local:7233"
}

output "backend_task_definition_arn" {
  value = aws_ecs_task_definition.backend.arn
}

output "backend_log_group_name" {
  value = aws_cloudwatch_log_group.backend.name
}

output "scraper_log_group_name" {
  value = aws_cloudwatch_log_group.scraper.name
}

output "temporal_worker_log_group_name" {
  value = aws_cloudwatch_log_group.temporal_worker.name
}

output "temporal_server_log_group_name" {
  value = aws_cloudwatch_log_group.temporal_server.name
}

output "execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}
