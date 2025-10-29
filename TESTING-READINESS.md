# Testing Readiness Report

## ✅ What's Complete and Ready

### 1. Lambda Functions Built Successfully ✅
```bash
dist/triager.zip              50MB  # Main triager with Playwright
dist/slack-interactions.zip    2.2KB # Button handler
```

**Built with:**
- Playwright for browser automation
- AWS SDK for CloudWatch & S3
- Axios for Datadog API
- All dependencies bundled

### 2. Terraform Infrastructure Code Complete ✅
```
terraform/
├── modules/alarm-triager/         # Reusable module
│   ├── main.tf (390 lines)       # S3, Lambda, API Gateway, IAM, alarms
│   ├── variables.tf (70 lines)
│   └── outputs.tf (40 lines)
└── envs/alarm-triager/staging/    # Staging environment
    ├── main.tf (60 lines)
    ├── variables.tf (70 lines)
    ├── outputs.tf (30 lines)
    └── terraform.tfvars (created)
```

### 3. AWS Credentials Configured ✅
- **Account**: 914958427285 (staging)
- **Role**: AdministratorAccess
- **User**: Rommel
- **Region**: us-east-1

### 4. Build Scripts Working ✅
- `./scripts/build-all.sh` - Successfully built both packages
- Node modules installed
- ZIP packages created

### 5. Integration Code Ready ✅
- `index.js` updated with `invokeTriage()` function
- `.env.example` updated with TRIAGER_FUNCTION_NAME
- Existing alarm Lambda can trigger triager when deployed

## ⚠️ What's Needed Before Deployment

### 1. Slack Bot Configuration Required
**Current Status**: Placeholder values in terraform.tfvars

**What You Need**:
1. Create Slack App at https://api.slack.com/apps
2. Add OAuth scopes: `chat:write`, `files:write`
3. Install to workspace
4. Get credentials:
   - **Bot Token**: Starts with `xoxb-` (for posting messages)
   - **Signing Secret**: From Basic Information (for verifying button clicks)

**Update in**: `terraform/envs/alarm-triager/staging/terraform.tfvars`
```hcl
slack_bot_token      = "xoxb-YOUR-ACTUAL-TOKEN"
slack_signing_secret = "YOUR-ACTUAL-SECRET"
```

### 2. Datadog Credentials Required
**Current Status**: Placeholder values in terraform.tfvars

**What You Need**:
1. Go to Datadog → Organization Settings → API Keys
2. Create or copy existing:
   - **API Key**: For authentication
   - **Application Key**: For reading logs

**Update in**: `terraform/envs/alarm-triager/staging/terraform.tfvars`
```hcl
datadog_api_key = "YOUR_ACTUAL_API_KEY"
datadog_app_key = "YOUR_ACTUAL_APP_KEY"
```

### 3. Application Health URL Configuration
**Current Status**: Generic placeholder

**What You Need**:
- Actual staging health check endpoint

**Update in**: `terraform/envs/alarm-triager/staging/terraform.tfvars`
```hcl
app_health_url   = "https://your-actual-staging-api.com/health"
app_service_name = "your-service-name-in-datadog"
```

### 4. Existing Alarm Lambda
**Current Status**: No cloudwatch alarm Lambda found in staging

**Options**:
- **Option A**: Deploy main cloudwatch-alarms Lambda first, then triager
- **Option B**: Deploy triager infrastructure first (it will work standalone but won't be triggered)
- **Option C**: Update terraform.tfvars to reference a test Lambda for now

## 🚀 Deployment Options

### Option 1: Deploy Infrastructure First (Recommended for Testing)

This approach deploys the triager infrastructure but doesn't require the main alarm Lambda to exist yet:

```bash
cd terraform/envs/alarm-triager/staging

# 1. Update terraform.tfvars with real Slack/Datadog credentials
nano terraform.tfvars

# 2. Initialize Terraform
AWS_PROFILE=staging terraform init

# 3. Preview changes
AWS_PROFILE=staging terraform plan

# 4. Deploy
AWS_PROFILE=staging terraform apply
```

**This will create**:
- S3 bucket with 3-day lifecycle
- Triager Lambda function
- Slack interactions Lambda
- API Gateway endpoint
- CloudWatch alarms for monitoring

**Then you can test triager directly**:
```bash
# Invoke triager with test payload
AWS_PROFILE=staging aws lambda invoke \
  --function-name staging-responsibid-alarm-triager \
  --payload file://../../../../cloudwatch-alarms/test/triager-test-event.json \
  response.json
```

### Option 2: Deploy Main Alarm Lambda First

If you want end-to-end testing immediately:

```bash
cd cloudwatch-alarms

# 1. Configure main alarm Lambda
cp .env.example .env
nano .env  # Add webhook URL and AWS credentials

# 2. Deploy main alarm Lambda
npm install
npm run deploy

# 3. Then deploy triager infrastructure (Option 1 above)

# 4. Update main alarm Lambda to trigger triager
aws lambda update-function-configuration \
  --function-name lambda-cloudwatch-slack \
  --environment Variables="{TRIAGER_FUNCTION_NAME=staging-responsibid-alarm-triager,...}"
```

### Option 3: Dry Run (Infrastructure Preview Only)

Test Terraform configuration without deploying:

```bash
cd terraform/envs/alarm-triager/staging
AWS_PROFILE=staging terraform init
AWS_PROFILE=staging terraform plan -out=plan.tfplan
# Review plan output, don't apply
```

## 🧪 Test Plans

### Test 1: Infrastructure Deployment
**Goal**: Verify all AWS resources created successfully

**Steps**:
1. Deploy with Terraform
2. Check S3 bucket exists: `aws s3 ls | grep alarm-screenshots`
3. Check Lambdas exist: `aws lambda list-functions | grep alarm-triager`
4. Check API Gateway: `aws apigatewayv2 get-apis`

**Expected**: All resources created, no errors

### Test 2: Triager Lambda Direct Invocation
**Goal**: Test triager function independently

**Prerequisites**: Slack/Datadog credentials configured

**Steps**:
```bash
cd cloudwatch-alarms
cat > test/triager-test-payload.json <<EOF
{
  "alarmName": "Test-CPU-Alarm",
  "alarmDescription": "Test alarm for triager",
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

AWS_PROFILE=staging aws lambda invoke \
  --function-name staging-responsibid-alarm-triager \
  --payload file://test/triager-test-payload.json \
  --log-type Tail \
  response.json

cat response.json
```

**Expected**:
- Lambda executes without errors
- S3 screenshots uploaded
- Slack message posted (if valid channel)
- CloudWatch logs show execution trace

### Test 3: End-to-End Alarm Flow
**Goal**: Test complete alarm → triager → Slack flow

**Prerequisites**: Main alarm Lambda deployed + triager configured

**Steps**:
1. Trigger test alarm or use existing test
2. Verify alarm posted to Slack immediately
3. Wait 30-60 seconds
4. Verify triager analysis posted as thread reply
5. Click interactive buttons
6. Verify button actions recorded

**Expected**: Complete flow works, triage analysis appears in thread

## 📊 Monitoring After Deployment

### Check Lambda Execution
```bash
# Triager logs
AWS_PROFILE=staging aws logs tail /aws/lambda/staging-responsibid-alarm-triager --follow

# Slack interactions logs
AWS_PROFILE=staging aws logs tail /aws/lambda/staging-responsibid-slack-interactions --follow
```

### Check CloudWatch Metrics
```bash
# Invocations
AWS_PROFILE=staging aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=staging-responsibid-alarm-triager \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Errors
AWS_PROFILE=staging aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=staging-responsibid-alarm-triager \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Check S3 Screenshots
```bash
AWS_PROFILE=staging aws s3 ls s3://staging-responsibid-alarm-screenshots/screenshots/ \
  --recursive --human-readable
```

## 💰 Cost Tracking

After deployment, monitor costs:

```bash
# Check monthly costs for alarm-triager resources
AWS_PROFILE=staging aws ce get-cost-and-usage \
  --time-period Start=$(date -d '1 month ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://cost-filter.json
```

**cost-filter.json**:
```json
{
  "Tags": {
    "Key": "Service",
    "Values": ["alarm-triager"]
  }
}
```

## 🎯 Next Actions

### Immediate (Required for any deployment):
1. ✅ Get Slack Bot Token and Signing Secret
2. ✅ Get Datadog API and Application Keys
3. ✅ Update `terraform/envs/alarm-triager/staging/terraform.tfvars`
4. ✅ Review and adjust `app_health_url` if needed

### For Testing (Choose one):
- **Quick Test**: Deploy infrastructure → Direct Lambda invoke → Verify
- **Full Test**: Deploy main alarm Lambda → Deploy triager → Trigger alarm → Verify

### For Production:
1. Test thoroughly in staging first
2. Create `terraform/envs/alarm-triager/production/` directory
3. Copy and adjust configuration
4. Deploy to production with real credentials
5. Monitor for 24-48 hours
6. Tune decision logic based on accuracy

## 📝 Current Status Summary

| Component | Status | Ready to Deploy |
|-----------|--------|----------------|
| Lambda Code | ✅ Built | Yes |
| Terraform Infrastructure | ✅ Complete | Yes |
| Build Scripts | ✅ Working | Yes |
| AWS Credentials | ✅ Configured | Yes |
| Slack Configuration | ⚠️ Needs real credentials | No |
| Datadog Configuration | ⚠️ Needs real credentials | No |
| Health URL | ⚠️ Needs verification | No |
| Main Alarm Lambda | ❌ Not deployed in staging | No (for E2E) |

**Overall**: 60% ready - needs Slack/Datadog credentials to proceed with deployment

## 🔐 Security Notes

### Credentials Management Options:

**Option A: Environment Variables** (Quick, less secure)
```hcl
# In terraform.tfvars
slack_bot_token = "xoxb-real-token"
datadog_api_key = "real-key"
```

**Option B: AWS Secrets Manager** (Recommended)
```bash
# Store secrets
aws secretsmanager create-secret \
  --name alarm-triager/staging/slack \
  --secret-string '{"bot_token":"xoxb-...","signing_secret":"..."}'

aws secretsmanager create-secret \
  --name alarm-triager/staging/datadog \
  --secret-string '{"api_key":"...","app_key":"..."}'
```

Then update Lambda to read from Secrets Manager.

**Option C: Terraform Variables from Environment**
```bash
export TF_VAR_slack_bot_token="xoxb-..."
export TF_VAR_datadog_api_key="..."
terraform apply
```

## 📚 Documentation References

- **Deployment Guide**: `DEPLOYMENT.md`
- **Architecture**: `claudedocs/infrastructure-design.md`
- **Cost Analysis**: `claudedocs/cost-analysis.md`
- **Implementation Details**: `IMPLEMENTATION-COMPLETE.md`
- **Project Overview**: `README-TRIAGER.md`

---

**Ready to proceed once you have**:
1. Slack Bot Token (`xoxb-...`)
2. Slack Signing Secret
3. Datadog API Key
4. Datadog Application Key

Then run: `cd terraform/envs/alarm-triager/staging && AWS_PROFILE=staging terraform init && terraform apply`
