# BORJIE Terraform Infrastructure

AWS infrastructure for the BORJIE Property Management SaaS platform.

## Architecture

- **VPC** – Public/private subnets, NAT gateway, Internet gateway, route tables
- **RDS** – PostgreSQL 15 with parameter groups, security groups
- **Redis** – ElastiCache Redis 7 cluster
- **ECS** – Fargate cluster with API gateway, ALB, and app services (estate-manager, customer-app, owner-portal, admin-portal)

## Directory Structure

```
terraform/
├── main.tf              # Root config (use with workspaces)
├── variables.tf
├── outputs.tf
├── backend.hcl.example
├── modules/
│   ├── vpc/              # VPC, subnets, NAT, IGW, route tables
│   ├── rds/              # PostgreSQL, security groups, parameter groups
│   ├── redis/            # ElastiCache Redis cluster
│   └── ecs/              # ECS cluster, task definitions, services, ALB
└── environments/
    ├── staging/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── outputs.tf
    │   ├── staging.tfvars
    │   └── backend.hcl.example
    └── production/
        ├── main.tf
        ├── variables.tf
        ├── outputs.tf
        ├── production.tfvars
        └── backend.hcl.example
```

## Prerequisites

1. **AWS CLI** configured with credentials
2. **Terraform** >= 1.5.0
3. **S3 bucket** for state (versioning enabled)
4. **DynamoDB table** for state locking (partition key: `LockID`)

## Usage

### Option A: Environment-specific directories (recommended)

Each environment has its own state file.

**Staging:**

```bash
cd environments/staging
cp backend.hcl.example backend.hcl
# Edit backend.hcl with your bucket, key, region, dynamodb_table
terraform init -backend-config=backend.hcl
terraform plan -var-file=staging.tfvars -var="rds_username=admin" -var="rds_password=YOUR_SECURE_PASSWORD"
terraform apply -var-file=staging.tfvars -var="rds_username=admin" -var="rds_password=YOUR_SECURE_PASSWORD"
```

**Production:**

```bash
cd environments/production
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform plan -var-file=production.tfvars -var="rds_username=admin" -var="rds_password=YOUR_SECURE_PASSWORD"
terraform apply -var-file=production.tfvars -var="rds_username=admin" -var="rds_password=YOUR_SECURE_PASSWORD"
```

### Option B: Root with workspaces

```bash
terraform workspace new staging   # first time only
terraform workspace select staging
terraform init -backend-config=backend.hcl
terraform apply -var-file=environments/staging/staging.tfvars -var="rds_username=admin" -var="rds_password=YOUR_SECURE_PASSWORD"
```

## Sensitive Variables

Never commit `rds_username` or `rds_password`. Use one of:

- `-var="rds_username=..." -var="rds_password=..."`
- `TF_VAR_rds_username` and `TF_VAR_rds_password` environment variables
- A `.tfvars` file excluded from git (e.g. `secrets.tfvars`)

## Outputs

After apply, useful outputs include:

- `api_url` – API base URL
- `alb_dns_name` – ALB DNS name
- `rds_endpoint` – RDS endpoint (sensitive)
- `redis_endpoint` – Redis endpoint
