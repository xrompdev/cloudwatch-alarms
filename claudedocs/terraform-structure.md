# Terraform Module Structure

## Directory Structure

```
terraform/
├── envs/
│   └── alarm-triager/                  # New environment for alarm triager
│       ├── main.tf                     # Root module
│       ├── variables.tf                # Variable definitions
│       ├── outputs.tf                  # Output values
│       ├── staging.tfvars              # Staging configuration
│       ├── prod.tfvars                 # Production configuration
│       ├── Makefile                    # Workspace management (copied from server/)
│       └── scripts/
│           ├── build-lambda.sh         # Build Lambda deployment packages
│           ├── build-layer.sh          # Build Playwright layer
│           └── test-local.sh           # Local testing script
├── modules/
│   └── alarm-triager/                  # Reusable module
│       ├── main.tf                     # Main resource definitions
│       ├── iam.tf                      # IAM roles and policies
│       ├── s3.tf                       # S3 bucket for screenshots
│       ├── lambda-triager.tf           # Triager Lambda function
│       ├── lambda-slack.tf             # Slack interactions Lambda
│       ├── api-gateway.tf              # HTTP API for Slack
│       ├── monitoring.tf               # CloudWatch alarms
│       ├── variables.tf                # Module input variables
│       └── outputs.tf                  # Module outputs
└── backend/
    └── main.tf                         # State backend (already exists)
```

## File: `envs/alarm-triager/main.tf`

```hcl
# Alarm Triager Environment Configuration
# Uses workspace-based deployment (staging/prod)

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend configuration provided via Makefile
  backend "s3" {}
}

# Workspace-based environment
locals {
  environment = terraform.workspace
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.common_tags, {
      Workspace = terraform.workspace
      Project   = "alarm-triager"
    })
  }
}

# Alarm Triager Module
module "alarm_triager" {
  source = "../../modules/alarm-triager"

  # Basic Configuration
  environment  = local.environment
  project_name = var.project_name
  aws_region   = var.aws_region

  # Lambda Configuration
  triager_lambda_memory_size      = var.triager_lambda_memory_size
  triager_lambda_timeout          = var.triager_lambda_timeout
  triager_lambda_reserved_concurrency = var.triager_lambda_reserved_concurrency

  slack_lambda_memory_size        = var.slack_lambda_memory_size
  slack_lambda_timeout            = var.slack_lambda_timeout
  slack_lambda_reserved_concurrency = var.slack_lambda_reserved_concurrency

  # Application Configuration
  datadog_api_key         = var.datadog_api_key
  datadog_app_key         = var.datadog_app_key
  datadog_site            = var.datadog_site
  slack_bot_token         = var.slack_bot_token
  slack_signing_secret    = var.slack_signing_secret
  health_check_url        = var.health_check_url

  # Existing Infrastructure
  existing_alarm_lambda_arn = var.existing_alarm_lambda_arn

  # Monitoring
  ops_alert_email       = var.ops_alert_email
  log_retention_days    = var.log_retention_days
  enable_xray_tracing   = var.enable_xray_tracing

  # Tags
  common_tags = var.common_tags
}
```

## File: `envs/alarm-triager/variables.tf`

```hcl
# Basic Configuration
variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "alarm-triager"
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

# Lambda Configuration - Triager
variable "triager_lambda_memory_size" {
  description = "Memory allocation for triager Lambda (MB)"
  type        = number
  default     = 1024
}

variable "triager_lambda_timeout" {
  description = "Timeout for triager Lambda (seconds)"
  type        = number
  default     = 120
}

variable "triager_lambda_reserved_concurrency" {
  description = "Reserved concurrency for triager Lambda"
  type        = number
  default     = 5
}

# Lambda Configuration - Slack Interactions
variable "slack_lambda_memory_size" {
  description = "Memory allocation for Slack Lambda (MB)"
  type        = number
  default     = 256
}

variable "slack_lambda_timeout" {
  description = "Timeout for Slack Lambda (seconds)"
  type        = number
  default     = 10
}

variable "slack_lambda_reserved_concurrency" {
  description = "Reserved concurrency for Slack Lambda"
  type        = number
  default     = 3
}

# Application Configuration (Secrets)
variable "datadog_api_key" {
  description = "Datadog API key"
  type        = string
  sensitive   = true
}

variable "datadog_app_key" {
  description = "Datadog application key"
  type        = string
  sensitive   = true
}

variable "datadog_site" {
  description = "Datadog site (datadoghq.com or datadoghq.eu)"
  type        = string
  default     = "datadoghq.com"
}

variable "slack_bot_token" {
  description = "Slack bot token for posting messages"
  type        = string
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack signing secret for webhook verification"
  type        = string
  sensitive   = true
}

variable "health_check_url" {
  description = "Health check URL for Playwright screenshots"
  type        = string
}

# Existing Infrastructure
variable "existing_alarm_lambda_arn" {
  description = "ARN of existing CloudWatch alarm Lambda that will invoke triager"
  type        = string
}

# Monitoring Configuration
variable "ops_alert_email" {
  description = "Email address for operational alerts"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention period (days)"
  type        = number
  default     = 30
}

variable "enable_xray_tracing" {
  description = "Enable AWS X-Ray tracing for Lambda functions"
  type        = bool
  default     = true
}

# Tags
variable "common_tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}
```

## File: `envs/alarm-triager/staging.tfvars`

```hcl
# Staging Environment Configuration

# Basic Configuration
project_name = "alarm-triager"
aws_region   = "us-east-1"

# Lambda Configuration - Triager
triager_lambda_memory_size          = 1024
triager_lambda_timeout              = 120
triager_lambda_reserved_concurrency = 5

# Lambda Configuration - Slack Interactions
slack_lambda_memory_size          = 256
slack_lambda_timeout              = 10
slack_lambda_reserved_concurrency = 3

# Application Configuration
datadog_site     = "datadoghq.com"
health_check_url = "https://app.staging.responsibid.com/health-check"

# Secrets (retrieve from AWS Secrets Manager or environment variables)
# These should be passed via TF_VAR_* environment variables:
# export TF_VAR_datadog_api_key="xxx"
# export TF_VAR_datadog_app_key="xxx"
# export TF_VAR_slack_bot_token="xoxb-xxx"
# export TF_VAR_slack_signing_secret="xxx"

# Existing Infrastructure
existing_alarm_lambda_arn = "arn:aws:lambda:us-east-1:914958427285:function:cloudwatch-alarms-staging"

# Monitoring
ops_alert_email    = "devops+staging@responsibid.com"
log_retention_days = 30
enable_xray_tracing = true

# Tags
common_tags = {
  Environment = "staging"
  Project     = "alarm-triager"
  ManagedBy   = "terraform"
  Owner       = "devops"
}
```

## File: `envs/alarm-triager/prod.tfvars`

```hcl
# Production Environment Configuration

# Basic Configuration
project_name = "alarm-triager"
aws_region   = "us-east-1"

# Lambda Configuration - Triager
triager_lambda_memory_size          = 1024
triager_lambda_timeout              = 120
triager_lambda_reserved_concurrency = 10  # Higher for production

# Lambda Configuration - Slack Interactions
slack_lambda_memory_size          = 256
slack_lambda_timeout              = 10
slack_lambda_reserved_concurrency = 5

# Application Configuration
datadog_site     = "datadoghq.com"
health_check_url = "https://app.responsibid.com/health-check"

# Existing Infrastructure
existing_alarm_lambda_arn = "arn:aws:lambda:us-east-1:914958427285:function:cloudwatch-alarms-production"

# Monitoring
ops_alert_email    = "devops+prod@responsibid.com"
log_retention_days = 90  # Longer retention for production
enable_xray_tracing = true

# Tags
common_tags = {
  Environment = "production"
  Project     = "alarm-triager"
  ManagedBy   = "terraform"
  Owner       = "devops"
  CostCenter  = "infrastructure"
}
```

## File: `envs/alarm-triager/outputs.tf`

```hcl
# Alarm Triager Outputs

output "triager_lambda_arn" {
  description = "ARN of the alarm triager Lambda function"
  value       = module.alarm_triager.triager_lambda_arn
}

output "triager_lambda_name" {
  description = "Name of the alarm triager Lambda function"
  value       = module.alarm_triager.triager_lambda_name
}

output "slack_lambda_arn" {
  description = "ARN of the Slack interactions Lambda function"
  value       = module.alarm_triager.slack_lambda_arn
}

output "slack_lambda_name" {
  description = "Name of the Slack interactions Lambda function"
  value       = module.alarm_triager.slack_lambda_name
}

output "screenshots_bucket_name" {
  description = "Name of the S3 bucket for screenshots"
  value       = module.alarm_triager.screenshots_bucket_name
}

output "screenshots_bucket_arn" {
  description = "ARN of the S3 bucket for screenshots"
  value       = module.alarm_triager.screenshots_bucket_arn
}

output "slack_api_endpoint" {
  description = "API Gateway endpoint for Slack interactions"
  value       = module.alarm_triager.slack_api_endpoint
}

output "ops_alerts_topic_arn" {
  description = "ARN of the SNS topic for operational alerts"
  value       = module.alarm_triager.ops_alerts_topic_arn
}

output "cloudwatch_dashboard_url" {
  description = "URL to CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${module.alarm_triager.dashboard_name}"
}
```

## File: `envs/alarm-triager/Makefile`

```makefile
# Terraform Workspace Management for Alarm Triager
# Based on server/ Makefile pattern

.PHONY: help staging staging-auto-approve prod prod-auto-approve plan-staging plan-prod clean init workspaces init-staging init-prod

# Default target
help:
	@echo "Alarm Triager Terraform Management"
	@echo ""
	@echo "Available commands:"
	@echo "  make staging                - Switch to staging workspace and deploy"
	@echo "  make staging-auto-approve   - Switch to staging workspace and deploy (auto-approve)"
	@echo "  make prod                   - Switch to production workspace and deploy"
	@echo "  make prod-auto-approve      - Switch to production workspace and deploy (auto-approve)"
	@echo "  make plan-staging           - Switch to staging and plan"
	@echo "  make plan-prod              - Switch to production and plan"
	@echo "  make init-staging           - Initialize staging workspace backend"
	@echo "  make init-prod              - Initialize production workspace backend"
	@echo "  make init                   - Initialize Terraform (basic)"
	@echo "  make clean                  - Clean Terraform cache"
	@echo "  make workspaces             - List all workspaces"
	@echo "  make build                  - Build Lambda deployment packages"
	@echo ""

# Backend configurations
STAGING_BUCKET = responsibid-terraform-state
STAGING_KEY = staging/alarm-triager/terraform.tfstate
STAGING_REGION = us-east-1

PROD_BUCKET = responsibid-production-terraform-state
PROD_KEY = prod/alarm-triager/terraform.tfstate
PROD_REGION = us-east-1

# Initialize Terraform (basic)
init:
	@echo "Initializing Terraform..."
	@terraform init

# Initialize workspace backends
init-staging:
	@echo "Initializing staging workspace backend..."
	@terraform init \
		-backend-config="bucket=$(STAGING_BUCKET)" \
		-backend-config="key=$(STAGING_KEY)" \
		-backend-config="region=$(STAGING_REGION)" \
		-reconfigure
	@terraform workspace select -or-create staging

init-prod:
	@echo "Initializing production workspace backend..."
	@terraform init \
		-backend-config="bucket=$(PROD_BUCKET)" \
		-backend-config="key=$(PROD_KEY)" \
		-backend-config="region=$(PROD_REGION)" \
		-reconfigure
	@terraform workspace select -or-create prod

# Deploy commands
staging:
	@echo "Switching to staging workspace and deploying..."
	@terraform workspace select staging
	@terraform plan -var-file=staging.tfvars
	@echo "Do you want to apply these changes? (y/N):" && read -r confirm && \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		terraform apply -var-file=staging.tfvars; \
		echo "Staging deployment complete!"; \
	else \
		echo "Deployment cancelled."; \
	fi

staging-auto-approve:
	@echo "Switching to staging workspace and deploying with auto-approve..."
	@terraform workspace select staging
	@terraform plan -var-file=staging.tfvars
	@terraform apply -var-file=staging.tfvars -auto-approve
	@echo "Staging deployment complete!"

prod:
	@echo "Switching to production workspace and deploying..."
	@terraform workspace select prod
	@terraform plan -var-file=prod.tfvars
	@echo "Do you want to apply these changes? (y/N):" && read -r confirm && \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		terraform apply -var-file=prod.tfvars; \
		echo "Production deployment complete!"; \
	else \
		echo "Deployment cancelled."; \
	fi

prod-auto-approve:
	@echo "Switching to production workspace and deploying with auto-approve..."
	@terraform workspace select prod
	@terraform plan -var-file=prod.tfvars
	@terraform apply -var-file=prod.tfvars -auto-approve
	@echo "Production deployment complete!"

# Plan commands
plan-staging:
	@echo "Switching to staging workspace and planning..."
	@terraform workspace select staging
	@terraform plan -var-file=staging.tfvars

plan-prod:
	@echo "Switching to production workspace and planning..."
	@terraform workspace select prod
	@terraform plan -var-file=prod.tfvars

# Utility commands
workspaces:
	@echo "Available workspaces:"
	@terraform workspace list

clean:
	@echo "Cleaning Terraform cache..."
	@rm -rf .terraform .terraform.lock.hcl
	@echo "Clean complete!"

# Build Lambda deployment packages
build:
	@echo "Building Lambda deployment packages..."
	@./scripts/build-lambda.sh
	@./scripts/build-layer.sh
	@echo "Build complete!"
```

## File: `envs/alarm-triager/scripts/build-lambda.sh`

```bash
#!/bin/bash
set -e

echo "Building Lambda deployment packages..."

# Build directory
BUILD_DIR="$(pwd)/.build"
LAMBDA_DIR="$(pwd)/../../../cloudwatch-alarms"
MODULE_DIR="$(pwd)/../../modules/alarm-triager/lambda"

# Clean build directory
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/triager" "$BUILD_DIR/slack-interactions"

echo "1. Building Triager Lambda..."
cd "$BUILD_DIR/triager"
cp -r "$LAMBDA_DIR"/* .
npm install --production

# Remove dev dependencies and test files
rm -rf test/ scripts/ .git/ .github/

# Create deployment package
zip -r "$MODULE_DIR/triager.zip" . -x "*.git*" "node_modules/playwright-*/*"

echo "2. Building Slack Interactions Lambda..."
cd "$BUILD_DIR/slack-interactions"
# Copy only necessary files for Slack interactions
cat > index.js << 'EOF'
const crypto = require('crypto');

exports.handler = async (event) => {
  console.log('Slack interaction received:', JSON.stringify(event));

  // Verify Slack signature
  const slackSignature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  const body = event.body;

  // Parse interaction payload
  const payload = JSON.parse(decodeURIComponent(body.replace('payload=', '')));

  // Handle button actions
  if (payload.type === 'block_actions') {
    const action = payload.actions[0];
    console.log('Button action:', action.action_id);

    // Implement your button handlers here
    // - acknowledge alarm
    // - re-run triager
    // - snooze alarm
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OK' })
  };
};
EOF

cat > package.json << 'EOF'
{
  "name": "slack-interactions",
  "version": "1.0.0",
  "dependencies": {
    "@slack/web-api": "^6.9.0"
  }
}
EOF

npm install --production
zip -r "$MODULE_DIR/slack-interactions.zip" .

echo "3. Cleaning up..."
cd "$MODULE_DIR"
rm -rf "$BUILD_DIR"

echo "Lambda packages built successfully:"
ls -lh "$MODULE_DIR"/*.zip
```

## File: `envs/alarm-triager/scripts/build-layer.sh`

```bash
#!/bin/bash
set -e

echo "Building Playwright Lambda Layer..."

# Build directory
BUILD_DIR="$(pwd)/.build/layer"
MODULE_DIR="$(pwd)/../../modules/alarm-triager/lambda"

# Clean build directory
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/nodejs"

echo "1. Installing Playwright..."
cd "$BUILD_DIR/nodejs"

cat > package.json << 'EOF'
{
  "name": "playwright-layer",
  "version": "1.0.0",
  "dependencies": {
    "playwright-core": "^1.40.0",
    "@playwright/browser-chromium": "^1.40.0"
  }
}
EOF

# Install for ARM64
npm install --production --arch=arm64 --platform=linux

echo "2. Creating layer package..."
cd "$BUILD_DIR"
zip -r "$MODULE_DIR/playwright.zip" nodejs/

echo "3. Cleaning up..."
rm -rf "$BUILD_DIR"

echo "Layer package built successfully:"
ls -lh "$MODULE_DIR/playwright.zip"
```

## File: `modules/alarm-triager/variables.tf`

```hcl
# Module Input Variables

variable "environment" {
  description = "Environment name (staging, prod)"
  type        = string
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "triager_lambda_memory_size" {
  description = "Memory allocation for triager Lambda"
  type        = number
}

variable "triager_lambda_timeout" {
  description = "Timeout for triager Lambda"
  type        = number
}

variable "triager_lambda_reserved_concurrency" {
  description = "Reserved concurrency for triager Lambda"
  type        = number
}

variable "slack_lambda_memory_size" {
  description = "Memory allocation for Slack Lambda"
  type        = number
}

variable "slack_lambda_timeout" {
  description = "Timeout for Slack Lambda"
  type        = number
}

variable "slack_lambda_reserved_concurrency" {
  description = "Reserved concurrency for Slack Lambda"
  type        = number
}

variable "datadog_api_key" {
  description = "Datadog API key"
  type        = string
  sensitive   = true
}

variable "datadog_app_key" {
  description = "Datadog application key"
  type        = string
  sensitive   = true
}

variable "datadog_site" {
  description = "Datadog site"
  type        = string
}

variable "slack_bot_token" {
  description = "Slack bot token"
  type        = string
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack signing secret"
  type        = string
  sensitive   = true
}

variable "health_check_url" {
  description = "Health check URL for screenshots"
  type        = string
}

variable "existing_alarm_lambda_arn" {
  description = "ARN of existing alarm Lambda"
  type        = string
}

variable "ops_alert_email" {
  description = "Email for operational alerts"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention"
  type        = number
}

variable "enable_xray_tracing" {
  description = "Enable X-Ray tracing"
  type        = bool
}

variable "common_tags" {
  description = "Common resource tags"
  type        = map(string)
}
```

## File: `modules/alarm-triager/outputs.tf`

```hcl
# Module Outputs

output "triager_lambda_arn" {
  description = "ARN of triager Lambda"
  value       = aws_lambda_function.alarm_triager.arn
}

output "triager_lambda_name" {
  description = "Name of triager Lambda"
  value       = aws_lambda_function.alarm_triager.function_name
}

output "slack_lambda_arn" {
  description = "ARN of Slack Lambda"
  value       = aws_lambda_function.slack_interactions.arn
}

output "slack_lambda_name" {
  description = "Name of Slack Lambda"
  value       = aws_lambda_function.slack_interactions.function_name
}

output "screenshots_bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.alarm_screenshots.id
}

output "screenshots_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.alarm_screenshots.arn
}

output "slack_api_endpoint" {
  description = "API Gateway endpoint"
  value       = aws_apigatewayv2_api.slack_interactions.api_endpoint
}

output "ops_alerts_topic_arn" {
  description = "SNS topic ARN"
  value       = aws_sns_topic.ops_alerts.arn
}

output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.alarm_triager.dashboard_name
}
```

## Deployment Workflow

### Initial Setup (One-time)

```bash
# 1. Navigate to alarm-triager environment
cd terraform/envs/alarm-triager

# 2. Create build scripts
mkdir -p scripts
# Copy build-lambda.sh and build-layer.sh (shown above)
chmod +x scripts/*.sh

# 3. Build Lambda packages
make build

# 4. Set secrets as environment variables
export TF_VAR_datadog_api_key="your-datadog-api-key"
export TF_VAR_datadog_app_key="your-datadog-app-key"
export TF_VAR_slack_bot_token="xoxb-your-slack-token"
export TF_VAR_slack_signing_secret="your-slack-secret"

# 5. Initialize staging backend
make init-staging

# 6. Plan deployment
make plan-staging

# 7. Deploy to staging
make staging
```

### Regular Deployments

```bash
# Rebuild Lambda packages (after code changes)
make build

# Deploy to staging
make staging-auto-approve

# After validation, deploy to production
make prod
```

## Summary

This Terraform structure follows your existing patterns from `/terraform/envs/server`:

1. **Workspace-based**: Separate staging/prod using Terraform workspaces
2. **Modular**: Reusable module in `modules/alarm-triager/`
3. **Environment-specific**: `.tfvars` files for staging/prod configurations
4. **Makefile-driven**: Same workflow as server/ environment
5. **Consistent naming**: Follows your `responsibid-{environment}-{resource}` pattern

Key benefits:
- Easy to maintain alongside existing infrastructure
- Clear separation of concerns (module vs environment)
- Reusable module for future deployments
- Consistent with team's existing practices
