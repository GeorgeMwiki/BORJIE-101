# =============================================================================
# ECR Module - Outputs
# =============================================================================

output "repository_urls" {
  description = "Map of repository names to URLs"
  value       = { for name, repo in aws_ecr_repository.services : name => repo.repository_url }
}

output "repository_arns" {
  description = "Map of repository names to ARNs"
  value       = { for name, repo in aws_ecr_repository.services : name => repo.arn }
}

output "registry_id" {
  description = "The registry ID"
  value       = values(aws_ecr_repository.services)[0].registry_id
}

output "registry_url" {
  description = "The ECR registry URL"
  value       = "${values(aws_ecr_repository.services)[0].registry_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
}

data "aws_region" "current" {}
