output "cluster_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "reader_endpoint" {
  value = aws_rds_cluster.main.reader_endpoint
}

output "secret_arn" {
  value = aws_secretsmanager_secret.aurora.arn
}

output "database_name" {
  value = aws_rds_cluster.main.database_name
}

output "cluster_identifier" {
  value = aws_rds_cluster.main.cluster_identifier
}
