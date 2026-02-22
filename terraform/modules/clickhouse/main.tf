locals {
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    Module      = "clickhouse"
  })
}

resource "random_password" "clickhouse" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "clickhouse" {
  name = "${var.project}/${var.environment}/clickhouse-credentials"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "clickhouse" {
  secret_id = aws_secretsmanager_secret.clickhouse.id
  secret_string = jsonencode({
    username = "morket"
    password = random_password.clickhouse.result
  })
}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_launch_template" "clickhouse" {
  name_prefix   = "${var.project}-${var.environment}-clickhouse-"
  image_id      = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type
  key_name      = var.key_pair_name != "" ? var.key_pair_name : null

  vpc_security_group_ids = [var.security_group_id]

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # Install ClickHouse
    yum install -y yum-utils
    yum-config-manager --add-repo https://packages.clickhouse.com/rpm/clickhouse.repo
    yum install -y clickhouse-server clickhouse-client

    # Configure ClickHouse
    cat > /etc/clickhouse-server/users.d/morket.xml <<'XMLEOF'
    <clickhouse>
      <users>
        <morket>
          <password_sha256_hex>$(echo -n "${random_password.clickhouse.result}" | sha256sum | cut -d' ' -f1)</password_sha256_hex>
          <networks><ip>::/0</ip></networks>
          <profile>default</profile>
          <quota>default</quota>
        </morket>
      </users>
    </clickhouse>
    XMLEOF

    cat > /etc/clickhouse-server/config.d/morket.xml <<'XMLEOF'
    <clickhouse>
      <max_memory_usage>3000000000</max_memory_usage>
      <max_threads>4</max_threads>
      <listen_host>0.0.0.0</listen_host>
    </clickhouse>
    XMLEOF

    # Mount EBS volume
    mkfs -t ext4 /dev/xvdf || true
    mkdir -p /var/lib/clickhouse
    mount /dev/xvdf /var/lib/clickhouse
    echo '/dev/xvdf /var/lib/clickhouse ext4 defaults,nofail 0 2' >> /etc/fstab
    chown -R clickhouse:clickhouse /var/lib/clickhouse

    # Start ClickHouse
    systemctl enable clickhouse-server
    systemctl start clickhouse-server
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.common_tags, { Name = "${var.project}-${var.environment}-clickhouse" })
  }
}

resource "aws_instance" "clickhouse" {
  subnet_id = var.private_subnet_id

  launch_template {
    id      = aws_launch_template.clickhouse.id
    version = "$Latest"
  }

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-clickhouse" })
}

resource "aws_ebs_volume" "clickhouse_data" {
  availability_zone = aws_instance.clickhouse.availability_zone
  size              = var.ebs_volume_size
  type              = "gp3"
  iops              = var.ebs_iops
  encrypted         = true

  tags = merge(local.common_tags, { Name = "${var.project}-${var.environment}-clickhouse-data" })
}

resource "aws_volume_attachment" "clickhouse_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.clickhouse_data.id
  instance_id = aws_instance.clickhouse.id
}

# AWS Backup for EBS snapshots
resource "aws_backup_vault" "clickhouse" {
  name = "${var.project}-${var.environment}-clickhouse"
  tags = local.common_tags
}

resource "aws_backup_plan" "clickhouse" {
  name = "${var.project}-${var.environment}-clickhouse"

  rule {
    rule_name         = "daily-snapshot"
    target_vault_name = aws_backup_vault.clickhouse.name
    schedule          = "cron(0 3 * * ? *)"

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }

  tags = local.common_tags
}

resource "aws_iam_role" "backup" {
  name = "${var.project}-${var.environment}-clickhouse-backup"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "clickhouse" {
  name         = "${var.project}-${var.environment}-clickhouse-ebs"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.clickhouse.id

  resources = [aws_ebs_volume.clickhouse_data.arn]
}
