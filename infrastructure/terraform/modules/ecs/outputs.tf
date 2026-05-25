# =============================================================================
# ECS Module - Outputs
# =============================================================================

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB zone ID for Route53"
  value       = aws_lb.main.zone_id
}

output "api_url" {
  description = "API base URL (http)"
  value       = "http://${aws_lb.main.dns_name}"
}

output "api_target_group_arn" {
  description = "API target group ARN"
  value       = aws_lb_target_group.api.arn
}
