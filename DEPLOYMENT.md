# Alarm Triager Deployment Guide

This guide walks you through deploying the intelligent alarm triaging system that uses Playwright, Datadog, and Slack to automatically analyze CloudWatch alarms.

## Prerequisites

### Required Tools
- Node.js 18+
- Terraform >= 1.0
- AWS CLI configured with appropriate credentials
- Access to AWS account with Lambda, S3, API Gateway permissions

### Required Accounts & API Keys
1. **Slack Bot**:
   - Create app at https://api.slack.com/apps
   - Add OAuth scopes: `chat:write`, `files:write`
   - Install to workspace
   - Copy Bot Token (starts with `xoxb-`)
   - Copy Signing Secret from Basic Information

2. **Datadog**:
   - Get API Key: Organization Settings → API Keys
   - Get Application Key: Organization Settings → Application Keys
   - Note your Datadog site (datadoghq.com, datadoghq.eu, etc)

3. **AWS**:
   - IAM role for Lambda execution
   - Existing CloudWatch alarm Lambda function name

## Step 1: Build Lambda Packages

```bash
cd cloudwatch-alarms

# Build both Lambda functions
./scripts/build-all.sh
```

This creates:
- `dist/triager.zip` - Main triage Lambda (~50MB with dependencies)
- `dist/slack-interactions.zip` - Slack button handler (~1MB)

## Step 2: Configure Terraform

```bash
cd ../terraform/envs/alarm-triager/staging

# Copy example configuration
cp terraform.tfvars.example terraform.tfvars

# Edit configuration
nano terraform.tfvars
```

Fill in the following values:

```hcl
# Existing alarm Lambda (must exist)
alarm_lambda_function_name = "lambda-cloudwatch-slack"

# Application configuration
app_health_url   = "https://staging-api.responsibid.com/health"
app_service_name = "staging-api"

# Datadog (from prerequisites)
datadog_api_key = "YOUR_DATADOG_API_KEY"
datadog_app_key = "YOUR_DATADOG_APP_KEY"
datadog_site    = "datadoghq.com"

# Slack (from prerequisites)
slack_bot_token      = "xoxb-YOUR-TOKEN"
slack_signing_secret = "YOUR_SIGNING_SECRET"
```

**Security Note**: Consider using AWS Secrets Manager:

```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name alarm-triager/staging/datadog \
  --secret-string '{"api_key":"xxx","app_key":"xxx"}'

aws secretsmanager create-secret \
  --name alarm-triager/staging/slack \
  --secret-string '{"bot_token":"xoxb-xxx","signing_secret":"xxx"}'

# Then reference in terraform.tfvars:
# datadog_api_key = data.aws_secretsmanager_secret_version.datadog.secret_string["api_key"]
```

## Step 3: Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Deploy (review plan carefully)
terraform apply
```

Expected resources created:
- S3 bucket with 3-day lifecycle
- 2 Lambda functions (triager + slack-interactions)
- HTTP API Gateway
- IAM roles and policies
- CloudWatch log groups
- CloudWatch alarms for monitoring

## Step 4: Configure Slack App

After deployment, get the API Gateway URL:

```bash
terraform output api_gateway_url
# Example: https://abc123xyz.execute-api.us-east-1.amazonaws.com
```

Configure Slack:
1. Go to https://api.slack.com/apps → Your App → Interactivity & Shortcuts
2. Enable Interactivity
3. Set Request URL: `{api_gateway_url}/slack/interactions`
4. Save Changes

## Step 5: Update Existing Alarm Lambda

Add environment variables to your existing CloudWatch alarm Lambda:

```bash
# Get triager function name from Terraform output
TRIAGER_NAME=$(cd ../terraform/envs/alarm-triager/staging && terraform output -raw triager_lambda_name)

# Update existing alarm Lambda
aws lambda update-function-configuration \
  --function-name lambda-cloudwatch-slack \
  --environment "Variables={
    UNENCRYPTED_HOOK_URL=your-slack-webhook,
    TRIAGER_FUNCTION_NAME=$TRIAGER_NAME,
    SLACK_CHANNEL=#alerts
  }"
```

Or update via `.env` and redeploy:

```bash
cd cloudwatch-alarms
echo "TRIAGER_FUNCTION_NAME=staging-responsibid-alarm-triager" >> .env
echo "SLACK_CHANNEL=#alerts" >> .env

npm run deploy
```

## Step 6: Test the System

### Test Triager Lambda Directly

```bash
cd cloudwatch-alarms

# Create test payload
cat > test/triager-test-event.json <<EOF
{
  "alarmName": "Test-High-CPU",
  "alarmDescription": "CPU usage above 80%",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "newState": "ALARM",
  "metric": {
    "name": "CPUUtilization",
    "namespace": "AWS/EC2",
    "threshold": 80,
    "statistic": "Average"
  },
  "region": "us-east-1",
  "slackThreadTs": "1234567890.123456",
  "slackChannel": "#test-alerts"
}
EOF

# Invoke triager
aws lambda invoke \
  --function-name staging-responsibid-alarm-triager \
  --payload file://test/triager-test-event.json \
  --log-type Tail \
  response.json

# Check response
cat response.json
```

### Test End-to-End

Trigger a real CloudWatch alarm or use existing test:

```bash
# Run existing test (posts to Slack, triggers triager)
npm test
```

Expected behavior:
1. Alarm posted to Slack immediately
2. Within 30-60 seconds, triager posts analysis as thread reply
3. Thread contains:
   - CloudWatch metric screenshot
   - Health check status + screenshot
   - Datadog logs summary
   - Triage verdict (✅ CAN IGNORE, ⚠️ MONITOR, 🚨 CRITICAL, etc)
   - Interactive buttons (Acknowledge, False Positive, Escalate)

## Step 7: Monitor and Validate

### Check CloudWatch Logs

```bash
# Triager Lambda logs
aws logs tail /aws/lambda/staging-responsibid-alarm-triager --follow

# Slack interactions logs
aws logs tail /aws/lambda/staging-responsibid-slack-interactions --follow
```

### Check CloudWatch Metrics

```bash
# Triager execution metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=staging-responsibid-alarm-triager \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Check S3 Screenshots

```bash
# List recent screenshots
aws s3 ls s3://staging-responsibid-alarm-screenshots/screenshots/ \
  --recursive --human-readable --summarize
```

## Troubleshooting

### Triager Not Triggered

Check existing alarm Lambda:
```bash
aws lambda get-function-configuration \
  --function-name lambda-cloudwatch-slack \
  --query 'Environment.Variables.TRIAGER_FUNCTION_NAME'
```

Check permissions:
```bash
aws lambda get-policy \
  --function-name staging-responsibid-alarm-triager
```

### Playwright Errors

Check Lambda memory and timeout:
```bash
aws lambda get-function-configuration \
  --function-name staging-responsibid-alarm-triager \
  --query '{Memory:MemorySize,Timeout:Timeout}'
```

Should be: Memory >= 1024, Timeout >= 120

### Slack Buttons Not Working

Verify API Gateway URL in Slack:
```bash
# Get URL
cd terraform/envs/alarm-triager/staging
terraform output api_gateway_url

# Test endpoint
curl -X POST {api_gateway_url}/slack/interactions \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "payload={\"type\":\"url_verification\",\"challenge\":\"test\"}"
```

### Screenshots Not Appearing

Check S3 bucket policy:
```bash
aws s3api get-bucket-policy \
  --bucket staging-responsibid-alarm-screenshots
```

Check Lambda IAM role:
```bash
aws iam get-role-policy \
  --role-name staging-responsibid-triager-lambda-role \
  --policy-name staging-responsibid-triager-lambda-policy
```

## Cost Monitoring

### Expected Costs (100 alarms/day)
- Lambda executions: ~$0.10/month
- S3 storage (3-day lifecycle): ~$0.01/month
- API Gateway: ~$0.01/month
- Data transfer: ~$0.20/month
- **Total: ~$0.32/month**

### Set Up Budget Alert

```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget file://budget.json

# budget.json:
{
  "BudgetName": "AlarmTriagerBudget",
  "BudgetLimit": {
    "Amount": "5",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {
    "TagKeyValue": ["Service$alarm-triager"]
  }
}
```

## Maintenance

### Update Lambda Code

```bash
cd cloudwatch-alarms

# Rebuild
./scripts/build-all.sh

# Redeploy
cd ../terraform/envs/alarm-triager/staging
terraform apply -target=module.alarm_triager.aws_lambda_function.triager
```

### Update Configuration

```bash
cd terraform/envs/alarm-triager/staging

# Edit variables
nano terraform.tfvars

# Apply changes
terraform apply
```

### Clean Old Screenshots

S3 lifecycle automatically deletes after 3 days. To manually clean:

```bash
aws s3 rm s3://staging-responsibid-alarm-screenshots/screenshots/ \
  --recursive
```

## Rollback

### Disable Triager

```bash
# Remove env var from alarm Lambda
aws lambda update-function-configuration \
  --function-name lambda-cloudwatch-slack \
  --environment "Variables={UNENCRYPTED_HOOK_URL=your-webhook}"
```

### Destroy Infrastructure

```bash
cd terraform/envs/alarm-triager/staging

# Preview destruction
terraform plan -destroy

# Destroy (careful!)
terraform destroy
```

## Next Steps

1. **Monitor** first 24 hours of triage decisions
2. **Tune** decision logic based on accuracy (triager/index.js:makeDecision)
3. **Add** ML training data collection for false positives
4. **Integrate** PagerDuty/OpsGenie for escalations
5. **Expand** to other alarm types (Elastic Beanstalk, CodeDeploy, etc)

## Support

- Documentation: `cloudwatch-alarms/claudedocs/`
- Architecture: `cloudwatch-alarms/claudedocs/architecture-diagram.md`
- Cost Analysis: `cloudwatch-alarms/claudedocs/cost-analysis.md`
- Terraform Details: `cloudwatch-alarms/claudedocs/terraform-structure.md`
