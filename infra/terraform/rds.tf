# =============================================================================
# BORJIE — RDS PostgreSQL with pgvector
# =============================================================================
# Primary operational database for all services. The `pgvector` extension
# is required by document-intelligence for embedding storage (doc-chat).
#
# Extension activation runs at first boot via the parameter group's
# `shared_preload_libraries` setting PLUS a one-shot migration that runs
# `CREATE EXTENSION IF NOT EXISTS vector;` (see
# `packages/database/src/migrations/0001_enable_pgvector.sql`).
# =============================================================================

variable "rds_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB."
  type        = number
  default     = 100
}

variable "rds_engine_version" {
  description = "Postgres engine version — must be >= 15 for pgvector via RDS."
  type        = string
  default     = "15.5"
}

variable "rds_db_name" {
  description = "Initial database name."
  type        = string
  default     = "borjie"
}

variable "rds_master_username" {
  description = "Master username."
  type        = string
  default     = "borjie"
}

# -----------------------------------------------------------------------------
# Parameter group — enables pgvector via shared_preload_libraries.
# -----------------------------------------------------------------------------
resource "aws_db_parameter_group" "postgres_pgvector" {
  name        = "${var.project_name}-${var.environment}-pg15-pgvector"
  family      = "postgres15"
  description = "BORJIE Postgres 15 with pgvector preloaded."

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements,vector"
    apply_method = "pending-reboot"
  }

  # pg_stat_statements is also enabled so we can surface slow-query metrics.
  parameter {
    name  = "pg_stat_statements.track"
    value = "ALL"
  }

  tags = {
    Component = "rds"
  }
}

data "aws_subnets" "rds" {
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project_name]
  }
}

data "aws_security_group" "rds" {
  name = "${var.project_name}-${var.environment}-rds"
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${var.project_name}-${var.environment}-postgres"
  subnet_ids = data.aws_subnets.rds.ids

  tags = {
    Component = "rds"
  }
}

resource "aws_db_instance" "postgres" {
  identifier           = "${var.project_name}-${var.environment}-postgres"
  engine               = "postgres"
  engine_version       = var.rds_engine_version
  instance_class       = var.rds_instance_class
  allocated_storage    = var.rds_allocated_storage
  storage_type         = "gp3"
  storage_encrypted    = true
  db_name              = var.rds_db_name
  username             = var.rds_master_username
  manage_master_user_password = true
  parameter_group_name = aws_db_parameter_group.postgres_pgvector.name
  db_subnet_group_name = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [data.aws_security_group.rds.id]
  multi_az             = var.environment == "production"
  backup_retention_period = var.environment == "production" ? 14 : 3
  deletion_protection  = var.environment == "production"
  skip_final_snapshot  = var.environment != "production"
  apply_immediately    = false
  performance_insights_enabled = true

  tags = {
    Component = "rds"
  }
}

output "postgres_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "RDS endpoint for DATABASE_URL assembly."
}

output "postgres_parameter_group" {
  value       = aws_db_parameter_group.postgres_pgvector.name
  description = "Parameter group name — confirms pgvector is preloaded."
}
