output "alb_arn" {
  value = aws_lb.main.arn
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "backend_target_group_arn" {
  value = aws_lb_target_group.backend.arn
}

output "scraper_target_group_arn" {
  value = aws_lb_target_group.scraper.arn
}
