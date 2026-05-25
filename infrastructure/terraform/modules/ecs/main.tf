# =============================================================================
# ECS Module - Cluster, Services, ALB for BORJIE
# =============================================================================

# -----------------------------------------------------------------------------
# ECS Cluster
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}-cluster"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-cluster"
  }
}

# -----------------------------------------------------------------------------
# IAM Roles for ECS
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.project_name}-${var.environment}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-task-execution"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-task"
  }
}

# -----------------------------------------------------------------------------
# Security Group - ALB
# -----------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-${var.environment}-alb-sg"
  description = "Security group for ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-alb-sg"
  }
}

# -----------------------------------------------------------------------------
# Security Group - ECS Tasks
# -----------------------------------------------------------------------------
resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-${var.environment}-ecs-sg"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow traffic from ALB"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-sg"
  }
}

# -----------------------------------------------------------------------------
# Application Load Balancer
# -----------------------------------------------------------------------------
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "production"

  tags = {
    Name = "${var.project_name}-${var.environment}-alb"
  }
}

# -----------------------------------------------------------------------------
# API Target Group
# -----------------------------------------------------------------------------
resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-${var.environment}-api-tg"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-api-tg"
  }
}

# -----------------------------------------------------------------------------
# ALB Listener - HTTP (redirect to HTTPS in production)
# -----------------------------------------------------------------------------
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# -----------------------------------------------------------------------------
# App Services - Target Groups, Task Definitions, Services, Listener Rules
# -----------------------------------------------------------------------------
resource "aws_lb_target_group" "app" {
  for_each = var.app_services

  name        = "${var.project_name}-${var.environment}-${each.key}-tg"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-${each.key}-tg"
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each = var.app_services

  family                   = "${var.project_name}-${var.environment}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = each.value.cpu
  memory                   = each.value.memory

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = each.value.image
      essential = true

      portMappings = [
        {
          containerPort = each.value.port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = tostring(each.value.port) },
        { name = "NEXT_PUBLIC_API_URL", value = "http://${aws_lb.main.dns_name}/api/v1" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app[each.key].name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = each.key
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${each.value.port}/ || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-${var.environment}-${each.key}"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each = var.app_services

  name             = "/ecs/${var.project_name}/${var.environment}/${each.key}"
  retention_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name = "${var.project_name}-${var.environment}-${each.key}-logs"
  }
}

resource "aws_ecs_service" "app" {
  for_each = var.app_services

  name            = "${var.project_name}-${var.environment}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app[each.key].arn
    container_name   = each.key
    container_port   = each.value.port
  }

  depends_on = [
    aws_lb_listener.http,
    aws_ecs_service.api
  ]

  tags = {
    Name = "${var.project_name}-${var.environment}-${each.key}"
  }
}

resource "aws_lb_listener_rule" "app" {
  for_each = var.app_services

  listener_arn = aws_lb_listener.http.arn
  priority     = 100 + index(keys(var.app_services), each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[each.key].arn
  }

  condition {
    path_pattern {
      values = [each.value.path_pattern]
    }
  }
}

# -----------------------------------------------------------------------------
# ECS Task Definition - API Gateway
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-${var.environment}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api-gateway"
      image     = var.api_image
      essential = true

      portMappings = [
        {
          containerPort = var.api_port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = tostring(var.api_port) }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.api_env.arn}:DATABASE_URL::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.api_env.arn}:REDIS_URL::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.api_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-${var.environment}-api"
  }
}

# -----------------------------------------------------------------------------
# Secrets Manager - API environment (stores DB/Redis URLs)
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "api_env" {
  name        = "${var.project_name}/${var.environment}/api-env"
  description = "API gateway environment variables"

  tags = {
    Name = "${var.project_name}-${var.environment}-api-env"
  }
}

resource "aws_secretsmanager_secret_version" "api_env" {
  secret_id = aws_secretsmanager_secret.api_env.id
  secret_string = jsonencode({
    DATABASE_URL = var.database_url
    REDIS_URL    = var.redis_url
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}/${var.environment}/api"
  retention_in_days  = var.environment == "production" ? 30 : 7
  tags = {
    Name = "${var.project_name}-${var.environment}-api-logs"
  }
}

# -----------------------------------------------------------------------------
# ECS Service - API Gateway
# -----------------------------------------------------------------------------
resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api-gateway"
    container_port   = var.api_port
  }

  depends_on = [
    aws_lb_listener.http,
    aws_secretsmanager_secret_version.api_env
  ]

  tags = {
    Name = "${var.project_name}-${var.environment}-api"
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
