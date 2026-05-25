# =============================================================================
# BORJIE Scheduler — ECS Fargate service
# =============================================================================
# Runs exactly one replica of the scheduler container (see
# docker/Dockerfile.scheduler). Running > 1 would double-fire every cron,
# so the service is pinned to desired_count = 1 with rolling deploys
# (maximum_percent = 100, minimum_healthy_percent = 0) to guarantee a
# single active task at any moment.
# =============================================================================

variable "scheduler_image" {
  description = "Fully-qualified ECR image URI for the scheduler container."
  type        = string
  default     = ""
}

variable "scheduler_cpu" {
  description = "Fargate CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 512
}

variable "scheduler_memory" {
  description = "Fargate memory in MiB."
  type        = number
  default     = 1024
}

variable "scheduler_log_retention_days" {
  description = "CloudWatch log retention window for the scheduler."
  type        = number
  default     = 30
}

# -----------------------------------------------------------------------------
# Log group — created here so it exists before the task definition.
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "scheduler" {
  name              = "/ecs/${var.project_name}-${var.environment}-scheduler"
  retention_in_days = var.scheduler_log_retention_days

  tags = {
    Component = "scheduler"
  }
}

# -----------------------------------------------------------------------------
# IAM — execution role (pull image, write logs) + task role (secrets read).
# Full IAM policy documents live in `iam.tf` (TODO in a follow-up wave); this
# module references the names by convention to keep scheduler.tf standalone.
# -----------------------------------------------------------------------------
data "aws_iam_role" "scheduler_execution" {
  name = "${var.project_name}-${var.environment}-ecs-execution"
}

data "aws_iam_role" "scheduler_task" {
  name = "${var.project_name}-${var.environment}-scheduler-task"
}

# -----------------------------------------------------------------------------
# Task definition
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "scheduler" {
  family                   = "${var.project_name}-${var.environment}-scheduler"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.scheduler_cpu
  memory                   = var.scheduler_memory
  execution_role_arn       = data.aws_iam_role.scheduler_execution.arn
  task_role_arn            = data.aws_iam_role.scheduler_task.arn

  container_definitions = jsonencode([
    {
      name      = "scheduler"
      image     = var.scheduler_image
      essential = true

      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "8080" },
        { name = "TZ", value = "UTC" },
        { name = "APP_VERSION", value = var.environment }
      ]

      # Secrets pulled from Secrets Manager at task boot — see secrets.tf.
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
        { name = "AWS_TEXTRACT_ACCESS_KEY_ID", valueFrom = aws_secretsmanager_secret.aws_textract_access_key.arn },
        { name = "AWS_TEXTRACT_SECRET_ACCESS_KEY", valueFrom = aws_secretsmanager_secret.aws_textract_secret_key.arn },
        { name = "GOOGLE_VISION_CREDENTIALS", valueFrom = aws_secretsmanager_secret.google_vision_credentials.arn },
        { name = "GEPG_SIGNING_KEY", valueFrom = aws_secretsmanager_secret.gepg_signing_key.arn },
        { name = "GEPG_SP_CODE", valueFrom = aws_secretsmanager_secret.gepg_sp_code.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.scheduler.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
  ])

  tags = {
    Component = "scheduler"
  }
}

# -----------------------------------------------------------------------------
# ECS service — singleton replica, no load balancer (internal /healthz only).
# -----------------------------------------------------------------------------
# The cluster + subnets + security group are declared in networking.tf
# (TODO in a follow-up wave). References kept by convention so this file
# can be applied in isolation once those resources exist.
# -----------------------------------------------------------------------------
data "aws_ecs_cluster" "main" {
  cluster_name = "${var.project_name}-${var.environment}"
}

data "aws_security_group" "scheduler" {
  name = "${var.project_name}-${var.environment}-scheduler"
}

data "aws_subnets" "private" {
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project_name]
  }
}

resource "aws_ecs_service" "scheduler" {
  name            = "${var.project_name}-${var.environment}-scheduler"
  cluster         = data.aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.scheduler.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Guarantee single-replica semantics during deploys.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = data.aws_subnets.private.ids
    security_groups  = [data.aws_security_group.scheduler.id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = {
    Component = "scheduler"
  }
}

output "scheduler_service_name" {
  value       = aws_ecs_service.scheduler.name
  description = "ECS service name for the scheduler (use for CLI debugging)."
}

output "scheduler_log_group" {
  value       = aws_cloudwatch_log_group.scheduler.name
  description = "CloudWatch log group carrying scheduler output."
}
