# Alarm Triager Infrastructure Design

## Executive Summary

Cost-efficient serverless infrastructure for CloudWatch alarm triaging system with Playwright screenshot capabilities, Datadog integration, and Slack interactions. Estimated monthly cost: $15-25 for 100 alarms/day.

## Architecture Overview

```
CloudWatch Alarm → SNS → Existing Lambda → Triager Lambda
                                              ├─ Playwright screenshots → S3 (3-day lifecycle)
                                              ├─ Datadog API calls
                                              └─ Slack notifications
                                                   ↓
                                              Slack button click
                                                   ↓
                                              API Gateway → Slack Interactions Lambda
```

## Answers to DevOps Questions

### 1. VPC Configuration
**Recommendation: Public Lambda (no VPC)**

Rationale:
- Triager Lambda needs internet access for: Playwright (public URLs), Datadog API, Slack API, S3
- VPC Lambda requires NAT Gateway ($32-45/month per AZ) + elastic IPs
- Current VPC setup (10.0.0.0/16) has NAT gateway, but adding Lambda to VPC adds complexity
- Public Lambda: Free NAT, faster cold starts (300ms vs 10s), simpler networking

Cost Impact: VPC saves $0, costs $32-45/month in NAT charges

**Decision: Use public Lambda execution**

### 2. Terraform Module Structure
**Recommendation: Create `/terraform/envs/alarm-triager` environment**

Follow existing pattern from `/envs/server`:
```
terraform/
  envs/
    alarm-triager/
      main.tf              # Root module, imports from modules/alarm-triager
      staging.tfvars       # Staging variables
      prod.tfvars          # Production variables
      variables.tf         # Variable definitions
      outputs.tf           # Output values
      Makefile             # Workspace management (copy from server/)
  modules/
    alarm-triager/
      main.tf              # Lambda functions, S3, API Gateway
      iam.tf               # IAM roles and policies
      s3.tf                # Screenshot bucket with lifecycle
      api-gateway.tf       # HTTP API for Slack
      variables.tf         # Module input variables
      outputs.tf           # Module outputs
```

This mirrors your existing server/ pattern:
- Workspace-based environments (staging/prod)
- Separate backend state per environment
- Reusable module in modules/

### 3. Cost Optimization Recommendations

**S3 Bucket**
- 3-day lifecycle policy (user requirement) ✓
- Intelligent-Tiering: NOT recommended (min 30 days, $0.0025/object overhead)
- Standard storage: $0.023/GB + $0.0004/1000 PUT
- Estimated: ~100 screenshots/day × 500KB × 3 days = 150MB = $0.003/month
- **Use: S3 Standard with 3-day expiration lifecycle**

**Lambda Sizing - Triager**
- Memory: 1024MB (Playwright chromium requirement)
- Timeout: 120s (Playwright page loads can be slow)
- Architecture: arm64 (20% cheaper than x86_64, Playwright supports it)
- Provisioned concurrency: NO (cold starts acceptable for alarms)
- Reserved concurrency: 5 (prevent runaway costs)

Cost calculation (100 invocations/day):
- Compute: 100 × 120s × 1024MB = 12,288,000 MB-seconds = $0.20/month
- Requests: 100 × 30 days = 3,000 requests = $0.01/month
- **Total: ~$0.21/month**

**Lambda Sizing - Slack Interactions**
- Memory: 256MB (lightweight, just processes button clicks)
- Timeout: 10s
- Architecture: arm64
- Provisioned concurrency: NO
- Reserved concurrency: 3

Cost calculation (50 interactions/day):
- Compute: 50 × 10s × 256MB × 30 = 384,000 MB-seconds = $0.006/month
- Requests: 50 × 30 = 1,500 requests = $0.003/month
- **Total: ~$0.01/month**

**API Gateway**
- Use: HTTP API (not REST API)
- HTTP API: $1.00/million requests
- REST API: $3.50/million requests (3.5× more expensive)
- Expected: 1,500 requests/month = $0.0015/month
- **Total: ~$0.002/month**

**CloudWatch Logs**
- Retention: 30 days (staging), 90 days (production)
- Ingestion: $0.50/GB
- Storage: $0.03/GB-month
- Estimated: 100 alarms × 50KB logs × 30 days = 150MB = $0.08/month ingestion + $0.005/month storage
- **Total: ~$0.09/month**

**Total Monthly Cost Estimate**
- S3: $0.003
- Triager Lambda: $0.21
- Slack Lambda: $0.01
- API Gateway: $0.002
- CloudWatch Logs: $0.09
- **Total: $0.315/month (~$3.78/year)**

Note: Extremely low cost due to low volume (100 alarms/day). At 1,000 alarms/day: ~$2/month.

### 4. Playwright Deployment Strategy
**Recommendation: Bundle Playwright with Lambda Layer**

Options analysis:
- **Option A: Bundle everything** (500MB+, exceeds Lambda 250MB deployment limit)
- **Option B: Lambda Layer** (Playwright + chromium in layer, code in function)
- **Option C: EFS mount** (Overkill, $0.30/GB-month)
- **Option D: Docker container** (More complexity, longer cold starts)

**Selected: Option B - Lambda Layer**

Implementation:
```bash
# Create layer with Playwright + chromium
npm init -y
npm install playwright-core playwright-chromium
# Layer includes node_modules with compiled chromium binary
```

Advantages:
- Chromium binary cached across invocations
- Function deployment package stays small (<10MB)
- Layer versioning for rollback capability
- Reusable across both Lambda functions if needed

Size breakdown:
- Layer: ~180MB (Playwright + chromium)
- Function code: ~5MB (your code + dependencies)
- Total: 185MB (under 250MB limit with 35% headroom)

### 5. CloudWatch Log Groups
**Recommendation: 30 days (staging), 90 days (production)**

Rationale:
- 30 days: Sufficient for debugging recent issues in staging
- 90 days: Compliance/audit trail for production alarms
- Cost: $0.03/GB-month storage (minimal at low volumes)
- Auto-deletion prevents indefinite accumulation

Alternative: Export to S3 for long-term archival
- CloudWatch Logs → S3 (Glacier Deep Archive)
- $0.00099/GB-month (96% cheaper than CloudWatch retention)
- Only if you need >1 year retention for compliance

**Decision: 30 days staging, 90 days prod, no S3 export (low volume)**

### 6. S3 Bucket Region
**Recommendation: Same region as Lambda (us-east-1)**

Rationale:
- Zero data transfer cost within same region
- Lower latency (< 10ms vs 50-100ms cross-region)
- Your existing setup: Lambda in us-east-1, VPC in us-east-1
- Cross-region transfer: $0.02/GB (wasted cost)

**Decision: S3 bucket in us-east-1**

### 7. Monitoring & Alerting for Triager
**Recommendation: Essential metrics only (cost-conscious)**

CloudWatch Alarms to create:
1. **Triager Lambda Errors** (Free tier: 10 alarms)
   - Metric: `Errors` > 5 in 5 minutes
   - Action: SNS → separate ops-alerts topic
   - Prevents alarm feedback loop

2. **Triager Lambda Duration** (Catch timeouts)
   - Metric: `Duration` > 100 seconds (warn at 83% of 120s timeout)
   - Action: SNS → ops-alerts topic

3. **Triager Lambda Throttles** (Reserved concurrency hit)
   - Metric: `Throttles` > 0 in 5 minutes
   - Action: SNS → ops-alerts topic

4. **S3 Bucket Size** (Cost monitoring)
   - Metric: `BucketSizeBytes` > 1GB (unusual for 3-day lifecycle)
   - Action: SNS → ops-alerts topic
   - Check: Once per day

5. **API Gateway 5xx Errors**
   - Metric: `5XXError` > 5 in 5 minutes
   - Action: SNS → ops-alerts topic

**Cost:** Free (5 alarms under free tier, 10 alarm limit)

**Additional: Lambda Insights (Optional)**
- Cost: $0.20/month per Lambda (2 functions = $0.40/month)
- Provides: Memory usage, cold starts, CPU time breakdown
- Recommendation: Enable for first month, disable after optimization

**X-Ray Tracing (Optional)**
- Cost: $5.00 per 1 million traces, first 100K free
- Estimated: 3,000 traces/month = FREE
- **Recommendation: Enable (free at this volume, valuable for debugging)**

## Terraform Resource Configuration

### S3 Bucket (Screenshot Storage)

```hcl
resource "aws_s3_bucket" "alarm_screenshots" {
  bucket = "responsibid-${var.environment}-alarm-screenshots"

  tags = merge(var.common_tags, {
    Purpose = "alarm-triager-screenshots"
  })
}

# 3-day lifecycle policy (user requirement)
resource "aws_s3_bucket_lifecycle_configuration" "alarm_screenshots" {
  bucket = aws_s3_bucket.alarm_screenshots.id

  rule {
    id     = "expire-screenshots"
    status = "Enabled"

    expiration {
      days = 3
    }

    # Clean up incomplete multipart uploads (cost optimization)
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Block public access (use presigned URLs for Slack)
resource "aws_s3_bucket_public_access_block" "alarm_screenshots" {
  bucket = aws_s3_bucket.alarm_screenshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Encryption at rest
resource "aws_s3_bucket_server_side_encryption_configuration" "alarm_screenshots" {
  bucket = aws_s3_bucket.alarm_screenshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"  # Free, no KMS charges
    }
  }
}

# CORS for Slack image embedding (if using public URLs)
resource "aws_s3_bucket_cors_configuration" "alarm_screenshots" {
  bucket = aws_s3_bucket.alarm_screenshots.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["https://slack.com"]
    max_age_seconds = 3600
  }
}
```

### Lambda - Triager Function

```hcl
# Lambda function for alarm triaging
resource "aws_lambda_function" "alarm_triager" {
  function_name = "responsibid-${var.environment}-alarm-triager"
  role          = aws_iam_role.alarm_triager.arn

  # Use container image OR zip deployment
  # Option A: Zip with layer (recommended)
  filename         = "${path.module}/lambda/triager.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/triager.zip")
  handler          = "index.handler"
  runtime          = "nodejs18.x"

  # Option B: Container image (alternative)
  # package_type = "Image"
  # image_uri    = "${var.ecr_repository_url}:latest"

  # Playwright requirements
  memory_size = 1024
  timeout     = 120

  # ARM64 for 20% cost savings
  architectures = ["arm64"]

  # Prevent runaway costs
  reserved_concurrent_executions = 5

  # Lambda layer with Playwright
  layers = [aws_lambda_layer_version.playwright.arn]

  environment {
    variables = {
      NODE_ENV                = var.environment
      S3_SCREENSHOTS_BUCKET   = aws_s3_bucket.alarm_screenshots.id
      DATADOG_API_KEY         = var.datadog_api_key
      DATADOG_APP_KEY         = var.datadog_app_key
      DATADOG_SITE            = var.datadog_site
      SLACK_BOT_TOKEN         = var.slack_bot_token
      HEALTH_CHECK_URL        = var.health_check_url
      AWS_REGION              = var.aws_region
      # Playwright-specific
      PLAYWRIGHT_BROWSERS_PATH = "/opt/nodejs/node_modules/playwright-core/.local-browsers"
    }
  }

  # X-Ray tracing (free at low volumes)
  tracing_config {
    mode = "Active"
  }

  # CloudWatch logs configuration
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.alarm_triager.name
  }

  tags = merge(var.common_tags, {
    Purpose = "alarm-triaging"
  })
}

# CloudWatch Log Group with retention
resource "aws_cloudwatch_log_group" "alarm_triager" {
  name              = "/aws/lambda/responsibid-${var.environment}-alarm-triager"
  retention_in_days = var.environment == "prod" ? 90 : 30

  tags = var.common_tags
}

# Lambda Layer with Playwright + Chromium
resource "aws_lambda_layer_version" "playwright" {
  layer_name          = "playwright-chromium-${var.environment}"
  filename            = "${path.module}/layers/playwright.zip"
  source_code_hash    = filebase64sha256("${path.module}/layers/playwright.zip")
  compatible_runtimes = ["nodejs18.x"]
  compatible_architectures = ["arm64"]

  description = "Playwright with Chromium for ARM64"
}
```

### Lambda - Slack Interactions Function

```hcl
resource "aws_lambda_function" "slack_interactions" {
  function_name = "responsibid-${var.environment}-slack-interactions"
  role          = aws_iam_role.slack_interactions.arn

  filename         = "${path.module}/lambda/slack-interactions.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/slack-interactions.zip")
  handler          = "index.handler"
  runtime          = "nodejs18.x"

  # Lightweight function
  memory_size   = 256
  timeout       = 10
  architectures = ["arm64"]

  reserved_concurrent_executions = 3

  environment {
    variables = {
      NODE_ENV           = var.environment
      SLACK_BOT_TOKEN    = var.slack_bot_token
      SLACK_SIGNING_SECRET = var.slack_signing_secret
      TRIAGER_LAMBDA_ARN = aws_lambda_function.alarm_triager.arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.slack_interactions.name
  }

  tags = merge(var.common_tags, {
    Purpose = "slack-button-interactions"
  })
}

resource "aws_cloudwatch_log_group" "slack_interactions" {
  name              = "/aws/lambda/responsibid-${var.environment}-slack-interactions"
  retention_in_days = var.environment == "prod" ? 90 : 30

  tags = var.common_tags
}
```

### API Gateway (HTTP API)

```hcl
# HTTP API (cheaper than REST API)
resource "aws_apigatewayv2_api" "slack_interactions" {
  name          = "responsibid-${var.environment}-slack-interactions"
  protocol_type = "HTTP"

  description = "Slack button interactions webhook endpoint"

  cors_configuration {
    allow_origins = ["https://slack.com"]
    allow_methods = ["POST"]
    allow_headers = ["Content-Type", "X-Slack-Request-Timestamp", "X-Slack-Signature"]
    max_age       = 300
  }

  tags = var.common_tags
}

# Lambda integration
resource "aws_apigatewayv2_integration" "slack_interactions" {
  api_id           = aws_apigatewayv2_api.slack_interactions.id
  integration_type = "AWS_PROXY"

  connection_type      = "INTERNET"
  integration_method   = "POST"
  integration_uri      = aws_lambda_function.slack_interactions.invoke_arn
  payload_format_version = "2.0"
}

# Route: POST /slack/interactions
resource "aws_apigatewayv2_route" "slack_interactions" {
  api_id    = aws_apigatewayv2_api.slack_interactions.id
  route_key = "POST /slack/interactions"
  target    = "integrations/${aws_apigatewayv2_integration.slack_interactions.id}"
}

# Default stage (automatic deployment)
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.slack_interactions.id
  name        = "$default"
  auto_deploy = true

  # Enable access logs
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }

  tags = var.common_tags
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/responsibid-${var.environment}-slack-interactions"
  retention_in_days = var.environment == "prod" ? 90 : 30

  tags = var.common_tags
}

# Lambda permission for API Gateway to invoke
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_interactions.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.slack_interactions.execution_arn}/*/*"
}
```

### IAM Roles and Policies

```hcl
# IAM Role for Triager Lambda
resource "aws_iam_role" "alarm_triager" {
  name = "responsibid-${var.environment}-alarm-triager-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = var.common_tags
}

# Basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "alarm_triager_basic" {
  role       = aws_iam_role.alarm_triager.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# X-Ray permissions
resource "aws_iam_role_policy_attachment" "alarm_triager_xray" {
  role       = aws_iam_role.alarm_triager.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# S3 permissions for screenshots
resource "aws_iam_role_policy" "alarm_triager_s3" {
  name = "s3-screenshots-access"
  role = aws_iam_role.alarm_triager.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.alarm_screenshots.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.alarm_screenshots.arn
      }
    ]
  })
}

# IAM Role for Slack Interactions Lambda
resource "aws_iam_role" "slack_interactions" {
  name = "responsibid-${var.environment}-slack-interactions-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = var.common_tags
}

resource "aws_iam_role_policy_attachment" "slack_interactions_basic" {
  role       = aws_iam_role.slack_interactions.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "slack_interactions_xray" {
  role       = aws_iam_role.slack_interactions.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# Permission to invoke triager Lambda (for retry/re-run actions)
resource "aws_iam_role_policy" "slack_interactions_invoke" {
  name = "invoke-triager-lambda"
  role = aws_iam_role.slack_interactions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "lambda:InvokeFunction"
      ]
      Resource = aws_lambda_function.alarm_triager.arn
    }]
  })
}

# Permission for existing alarm Lambda to invoke triager
resource "aws_lambda_permission" "existing_alarm_lambda_invoke" {
  statement_id  = "AllowExistingAlarmLambdaInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alarm_triager.function_name
  principal     = "lambda.amazonaws.com"
  # Replace with your existing alarm Lambda ARN
  source_arn    = var.existing_alarm_lambda_arn
}
```

### CloudWatch Alarms (Monitoring)

```hcl
# SNS Topic for ops alerts (separate from alarm notifications)
resource "aws_sns_topic" "ops_alerts" {
  name = "responsibid-${var.environment}-alarm-triager-ops"

  tags = merge(var.common_tags, {
    Purpose = "alarm-triager-operational-alerts"
  })
}

resource "aws_sns_topic_subscription" "ops_alerts_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.ops_alert_email
}

# Alarm 1: Triager Lambda Errors
resource "aws_cloudwatch_metric_alarm" "triager_errors" {
  alarm_name          = "responsibid-${var.environment}-triager-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Triager Lambda error count exceeded threshold"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.alarm_triager.function_name
  }

  tags = var.common_tags
}

# Alarm 2: Triager Lambda Duration (timeout warning)
resource "aws_cloudwatch_metric_alarm" "triager_duration" {
  alarm_name          = "responsibid-${var.environment}-triager-lambda-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = 100000  # 100 seconds (83% of 120s timeout)
  alarm_description   = "Triager Lambda approaching timeout threshold"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.alarm_triager.function_name
  }

  tags = var.common_tags
}

# Alarm 3: Triager Lambda Throttles
resource "aws_cloudwatch_metric_alarm" "triager_throttles" {
  alarm_name          = "responsibid-${var.environment}-triager-lambda-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Triager Lambda being throttled (concurrency limit hit)"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.alarm_triager.function_name
  }

  tags = var.common_tags
}

# Alarm 4: S3 Bucket Size (cost monitoring)
resource "aws_cloudwatch_metric_alarm" "s3_bucket_size" {
  alarm_name          = "responsibid-${var.environment}-screenshots-bucket-size"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BucketSizeBytes"
  namespace           = "AWS/S3"
  period              = 86400  # Daily check
  statistic           = "Average"
  threshold           = 1073741824  # 1GB
  alarm_description   = "Screenshot bucket exceeds expected size (check lifecycle)"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    BucketName = aws_s3_bucket.alarm_screenshots.id
    StorageType = "StandardStorage"
  }

  tags = var.common_tags
}

# Alarm 5: API Gateway 5xx Errors
resource "aws_cloudwatch_metric_alarm" "api_gateway_errors" {
  alarm_name          = "responsibid-${var.environment}-slack-api-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Slack interactions API Gateway 5xx error rate elevated"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    ApiId = aws_apigatewayv2_api.slack_interactions.id
  }

  tags = var.common_tags
}
```

## Infrastructure Deployment Strategy

### Phase 1: Initial Setup (Staging)
1. Create S3 backend for alarm-triager state (if not using existing)
2. Initialize Terraform workspace: `make init-staging`
3. Deploy S3 bucket only (validate lifecycle policy)
4. Deploy Lambda Layer with Playwright (test locally first)
5. Deploy Triager Lambda (without SNS trigger initially)
6. Test Lambda manually with sample CloudWatch alarm event
7. Deploy Slack Interactions Lambda + API Gateway
8. Test Slack interactions with curl/Postman
9. Add SNS trigger to existing alarm Lambda → Triager Lambda
10. Monitor for 1 week, validate costs

### Phase 2: Production Rollout
1. Switch workspace: `make init-prod`
2. Update prod.tfvars with production variables
3. Deploy with `make prod`
4. Enable CloudWatch alarms for monitoring
5. Set up budget alerts (AWS Budgets, $10/month threshold)

### Phase 3: Optimization
1. Review Lambda CloudWatch Insights (memory usage, cold starts)
2. Adjust memory allocation if needed (1024MB may be oversized)
3. Review S3 lifecycle effectiveness (screenshot retention)
4. Consider Lambda@Edge for geographically distributed alarms (future)

## Testing Strategy for AWS Resources

### 1. Local Testing (Pre-Deployment)

**Playwright Lambda Test**
```bash
# In cloudwatch-alarms/ directory
npm install playwright-core playwright-chromium aws-sdk @slack/web-api

# Create test harness
node test-local.js
```

**test-local.js:**
```javascript
const playwright = require('playwright-chromium');
const AWS = require('aws-sdk');

async function testTriager() {
  // Test Playwright screenshot
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://app.staging.responsibid.com/health-check');
  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();

  console.log('Screenshot captured:', screenshot.length, 'bytes');

  // Test S3 upload (use localstack or actual S3)
  const s3 = new AWS.S3();
  const result = await s3.putObject({
    Bucket: 'test-bucket',
    Key: 'test-screenshot.png',
    Body: screenshot,
    ContentType: 'image/png'
  }).promise();

  console.log('S3 upload successful:', result);
}

testTriager().catch(console.error);
```

### 2. Lambda Layer Testing

**Build and test layer locally:**
```bash
# In terraform/modules/alarm-triager/layers/
mkdir -p playwright/nodejs
cd playwright/nodejs
npm init -y
npm install playwright-core playwright-chromium

# Create layer zip
cd ..
zip -r ../playwright.zip nodejs/

# Test layer size
ls -lh ../playwright.zip  # Should be ~180MB
```

### 3. Infrastructure Validation

**Terraform Plan Review:**
```bash
cd terraform/envs/alarm-triager
make init-staging
make plan-staging

# Validate outputs:
# - S3 bucket with lifecycle policy
# - Lambda functions with correct memory/timeout
# - IAM roles with least privilege
# - API Gateway endpoint
# - CloudWatch alarms created
```

### 4. Integration Testing (Post-Deployment)

**Test 1: Manual Lambda Invoke**
```bash
# Invoke triager Lambda with sample CloudWatch alarm
aws lambda invoke \
  --function-name responsibid-staging-alarm-triager \
  --payload file://test-event.json \
  --region us-east-1 \
  output.json

cat output.json
```

**test-event.json:**
```json
{
  "Records": [{
    "Sns": {
      "Message": "{\"AlarmName\":\"test-alarm\",\"AlarmDescription\":\"Test\",\"NewStateValue\":\"ALARM\",\"NewStateReason\":\"Test reason\",\"Trigger\":{\"MetricName\":\"CPUUtilization\",\"Namespace\":\"AWS/EC2\"}}"
    }
  }]
}
```

**Test 2: S3 Lifecycle Verification**
```bash
# Upload test object
aws s3 cp test.png s3://responsibid-staging-alarm-screenshots/test-$(date +%s).png

# Check lifecycle policy
aws s3api get-bucket-lifecycle-configuration \
  --bucket responsibid-staging-alarm-screenshots

# Verify expiration (wait 3 days, check object deleted)
```

**Test 3: API Gateway Test**
```bash
# Get API Gateway endpoint
API_ENDPOINT=$(terraform output -raw slack_api_endpoint)

# Test POST /slack/interactions
curl -X POST $API_ENDPOINT/slack/interactions \
  -H "Content-Type: application/json" \
  -d '{"type":"block_actions","actions":[{"action_id":"test"}]}'
```

**Test 4: End-to-End Flow**
```bash
# Trigger CloudWatch alarm → SNS → Existing Lambda → Triager Lambda
aws cloudwatch set-alarm-state \
  --alarm-name "test-alarm" \
  --state-value ALARM \
  --state-reason "Testing alarm triager flow"

# Check CloudWatch Logs
aws logs tail /aws/lambda/responsibid-staging-alarm-triager --follow
```

### 5. Cost Validation

**Set up AWS Budget:**
```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget file://budget.json \
  --notifications-with-subscribers file://notifications.json
```

**budget.json:**
```json
{
  "BudgetName": "AlarmTriagerMonthlyCost",
  "BudgetLimit": {
    "Amount": "10",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {
    "TagKeyValue": ["user:Project$alarm-triager"]
  }
}
```

**Monitor costs weekly:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://cost-filter.json
```

## Security Considerations

### 1. Secrets Management
- Store Slack tokens in AWS Secrets Manager (not environment variables)
- Rotate secrets quarterly
- Use IAM policies to restrict secret access

### 2. S3 Bucket Security
- Block all public access (presigned URLs for Slack)
- Enable encryption at rest (AES256)
- Enable MFA delete for production bucket
- Audit S3 access logs weekly

### 3. API Gateway Security
- Validate Slack request signatures (X-Slack-Signature)
- Implement rate limiting (5 req/sec per IP)
- Use AWS WAF for production (OWASP Top 10 rules)

### 4. Lambda Security
- Minimal IAM permissions (least privilege)
- No VPC access (reduces attack surface)
- Enable X-Ray for runtime security monitoring
- Regular dependency updates (npm audit)

## Rollback Strategy

### Terraform State Rollback
```bash
# List state versions
aws s3api list-object-versions \
  --bucket responsibid-terraform-state \
  --prefix staging/alarm-triager/terraform.tfstate

# Restore previous version
aws s3api get-object \
  --bucket responsibid-terraform-state \
  --key staging/alarm-triager/terraform.tfstate \
  --version-id <VERSION_ID> \
  terraform.tfstate.backup

# Apply previous state
terraform apply
```

### Lambda Rollback
```bash
# List Lambda versions
aws lambda list-versions-by-function \
  --function-name responsibid-staging-alarm-triager

# Rollback to previous version
aws lambda update-function-configuration \
  --function-name responsibid-staging-alarm-triager \
  --environment Variables={...}
```

## Maintenance Plan

### Weekly
- Review CloudWatch Logs for errors
- Check S3 bucket size and lifecycle effectiveness
- Monitor Lambda duration trends

### Monthly
- Review AWS Cost Explorer for cost trends
- Update Playwright/Node.js dependencies
- Review and rotate secrets

### Quarterly
- Performance optimization (memory allocation tuning)
- Security audit (dependency vulnerabilities)
- Disaster recovery drill (restore from backup)

## Next Steps

1. Review and approve infrastructure design
2. Create Terraform module structure (`terraform/modules/alarm-triager/`)
3. Implement Lambda functions (triager.js, slack-interactions.js)
4. Build Playwright Lambda layer
5. Test locally with sample events
6. Deploy to staging environment
7. Integration testing and monitoring
8. Production rollout after 1-week staging validation

## Related Documentation

- Existing alarm Lambda: `/home/rom/project/responsibid/cloudwatch-alarms/index.js`
- Terraform server module: `/home/rom/project/responsibid/terraform/modules/server/`
- Backend configuration: `/home/rom/project/responsibid/terraform/backend/main.tf`
- Workspace management: `/home/rom/project/responsibid/terraform/envs/server/Makefile`
