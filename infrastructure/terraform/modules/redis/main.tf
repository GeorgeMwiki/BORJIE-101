# =============================================================================
# Redis Module - ElastiCache for BORJIE
# =============================================================================

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------
resource "aws_security_group" "redis" {
  name        = "${var.project_name}-${var.environment}-redis-sg"
  description = "Security group for ElastiCache Redis"
  vpc_id      = var.vpc_id

  ingress {
    description = "Redis from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-redis-sg"
  }
}

# -----------------------------------------------------------------------------
# Subnet Group
# -----------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.project_name}-${var.environment}-redis-subnet"
  }
}

# -----------------------------------------------------------------------------
# Parameter Group
# -----------------------------------------------------------------------------
resource "aws_elasticache_parameter_group" "main" {
  name   = "${var.project_name}-${var.environment}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-redis-params"
  }
}

# -----------------------------------------------------------------------------
# ElastiCache Replication Group (Redis)
# -----------------------------------------------------------------------------
resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.project_name}-${var.environment}-redis"
  description          = "Redis cluster for ${var.project_name} ${var.environment}"

  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_clusters
  port                 = 6379
  engine               = "redis"
  engine_version       = var.engine_version
  parameter_group_name = aws_elasticache_parameter_group.main.name

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = false

  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled         = var.num_cache_clusters > 1

  tags = {
    Name = "${var.project_name}-${var.environment}-redis"
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------
data "aws_vpc" "selected" {
  id = var.vpc_id
}
