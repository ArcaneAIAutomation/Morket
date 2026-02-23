# --- Backend Task Definition & Service ---

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project}-${var.environment}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    readonlyRootFilesystem = true

    linuxParameters = {
      capabilities = {
        drop = ["ALL"]
      }
    }

    environment = [for k, v in var.backend_env_vars : { name = k, value = v }]
    secrets     = [for k, v in var.backend_secrets : { name = k, valueFrom = v }]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "backend"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "backend" {
  name            = "${var.project}-${var.environment}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.backend_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.backend_target_group_arn
    container_name   = "backend"
    container_port   = 3000
  }

  tags = local.common_tags
}

# --- Scraper Task Definition & Service ---

resource "aws_ecs_task_definition" "scraper" {
  family                   = "${var.project}-${var.environment}-scraper"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.scraper_cpu
  memory                   = var.scraper_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "scraper"
    image     = var.scraper_image
    essential = true
    portMappings = [{ containerPort = 8001, protocol = "tcp" }]

    readonlyRootFilesystem = true

    linuxParameters = {
      capabilities = {
        drop = ["ALL"]
      }
    }

    environment = [for k, v in var.scraper_env_vars : { name = k, value = v }]
    secrets     = [for k, v in var.scraper_secrets : { name = k, valueFrom = v }]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:8001/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.scraper.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "scraper"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "scraper" {
  name            = "${var.project}-${var.environment}-scraper"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.scraper.arn
  desired_count   = var.scraper_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.scraper_target_group_arn
    container_name   = "scraper"
    container_port   = 8001
  }

  tags = local.common_tags
}

# --- Temporal Worker Task Definition & Service ---

resource "aws_ecs_task_definition" "temporal_worker" {
  family                   = "${var.project}-${var.environment}-temporal-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.temporal_worker_cpu
  memory                   = var.temporal_worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "temporal-worker"
    image     = var.temporal_worker_image
    essential = true
    command   = ["node", "dist/modules/enrichment/temporal/worker.js"]

    readonlyRootFilesystem = true

    linuxParameters = {
      capabilities = {
        drop = ["ALL"]
      }
    }

    environment = [for k, v in var.temporal_worker_env_vars : { name = k, value = v }]
    secrets     = [for k, v in var.temporal_worker_secrets : { name = k, valueFrom = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.temporal_worker.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "temporal-worker"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "temporal_worker" {
  name            = "${var.project}-${var.environment}-temporal-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.temporal_worker.arn
  desired_count   = var.temporal_worker_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  tags = local.common_tags
}

# --- Temporal Server Task Definition & Service ---

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.project}.local"
  vpc  = data.aws_vpc.selected.id

  tags = local.common_tags
}

resource "aws_service_discovery_service" "temporal" {
  name = "temporal"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "temporal_server" {
  family                   = "${var.project}-${var.environment}-temporal-server"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.temporal_server_cpu
  memory                   = var.temporal_server_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "temporal-server"
    image     = var.temporal_server_image
    essential = true
    portMappings = [{ containerPort = 7233, protocol = "tcp" }]

    readonlyRootFilesystem = true

    linuxParameters = {
      capabilities = {
        drop = ["ALL"]
      }
    }

    environment = [for k, v in var.temporal_server_env_vars : { name = k, value = v }]
    secrets     = [for k, v in var.temporal_server_secrets : { name = k, valueFrom = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.temporal_server.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "temporal-server"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "temporal_server" {
  name            = "${var.project}-${var.environment}-temporal-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.temporal_server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.temporal_security_group_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal.arn
  }

  tags = local.common_tags
}

# --- Data Sources ---

data "aws_region" "current" {}

data "aws_vpc" "selected" {
  filter {
    name   = "tag:Name"
    values = ["${var.project}-${var.environment}-vpc"]
  }
}

# --- Auto-scaling ---

resource "aws_appautoscaling_target" "backend" {
  count              = var.enable_autoscaling ? 1 : 0
  max_capacity       = var.autoscaling_max_capacity
  min_capacity       = var.backend_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.project}-${var.environment}-backend-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend[0].resource_id
  scalable_dimension = aws_appautoscaling_target.backend[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_target" "scraper" {
  count              = var.enable_autoscaling ? 1 : 0
  max_capacity       = var.autoscaling_max_capacity
  min_capacity       = var.scraper_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.scraper.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "scraper_cpu" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.project}-${var.environment}-scraper-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.scraper[0].resource_id
  scalable_dimension = aws_appautoscaling_target.scraper[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.scraper[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
