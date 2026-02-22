# --- Networking ---

output "vpc_id" {
  value = module.vpc.vpc_id
}

# --- ALB ---

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

# --- ECS ---

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "backend_service_name" {
  value = module.ecs.backend_service_name
}

output "scraper_service_name" {
  value = module.ecs.scraper_service_name
}

output "temporal_server_endpoint" {
  value = module.ecs.temporal_server_endpoint
}

# --- Data Stores ---

output "aurora_cluster_endpoint" {
  value     = module.aurora.cluster_endpoint
  sensitive = true
}

output "aurora_reader_endpoint" {
  value     = module.aurora.reader_endpoint
  sensitive = true
}

output "clickhouse_private_ip" {
  value     = module.clickhouse.private_ip
  sensitive = true
}

output "redis_primary_endpoint" {
  value     = module.redis.primary_endpoint
  sensitive = true
}

output "opensearch_domain_endpoint" {
  value     = module.opensearch.domain_endpoint
  sensitive = true
}

# --- Frontend ---

output "cloudfront_distribution_id" {
  value = module.cloudfront.distribution_id
}

output "cloudfront_domain_name" {
  value = module.cloudfront.distribution_domain_name
}

output "frontend_bucket_name" {
  value = module.s3.frontend_bucket_name
}
