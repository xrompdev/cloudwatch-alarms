# Intelligent Alarm Triager

Automated alarm analysis system that uses Playwright for visual inspection, Datadog for log correlation, and Slack for interactive notifications.

## Overview

When a CloudWatch alarm triggers:
1. **Immediate**: Alarm posted to Slack (existing behavior)
2. **Automated Analysis** (30-60s later):
   - 📊 Screenshots CloudWatch metrics
   - 🏥 Checks application health with full page rendering
   - 📝 Queries Datadog logs for errors
   - 🤖 Makes triage decision
   - 💬 Posts analysis as Slack thread reply with interactive buttons

## Architecture

```
CloudWatch Alarm → SNS → Existing Lambda → Slack
                            ↓
                    Invoke Triager Lambda (async)
                            ↓
                    [Playwright + Datadog + Decision Logic]
                            ↓
                    Post to Slack Thread
                            ↓
                    [Interactive Buttons] → API Gateway → Slack Interactions Lambda
```

## Features

### Intelligent Triage
- **✅ CAN IGNORE**: App healthy, no errors
- **⚠️ MONITOR**: Metric recovered, minimal errors
- **🚨 CRITICAL**: App unhealthy, many errors
- **👀 NEEDS REVIEW**: Inconclusive, manual review needed

### Evidence Collection
- CloudWatch metric graphs with threshold annotations
- Health endpoint screenshots (success + error states)
- Datadog error logs (±5 minutes from alarm)
- Direct links to CloudWatch and Datadog

### Interactive Actions
- **✅ Acknowledge**: Mark as seen
- **🔕 False Positive**: Record for learning
- **🚨 Escalate**: Trigger on-call (extensible)

## Quick Start

### 1. Build Lambda Packages
```bash
./scripts/build-all.sh
```

### 2. Deploy Infrastructure
```bash
cd ../terraform/envs/alarm-triager/staging
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init
terraform plan
terraform apply
```

### 3. Configure Slack App
1. Get API Gateway URL: `terraform output api_gateway_url`
2. Slack App → Interactivity → Request URL: `{url}/slack/interactions`

### 4. Update Alarm Lambda
```bash
# Add to .env:
TRIAGER_FUNCTION_NAME=staging-responsibid-alarm-triager
SLACK_CHANNEL=#alerts

# Redeploy
npm run deploy
```

### 5. Test
```bash
npm test
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## Project Structure

```
cloudwatch-alarms/
├── triager/
│   ├── index.js           # Main triage logic
│   └── package.json       # Dependencies (Playwright, AWS SDK, Axios)
├── slack-interactions/
│   ├── index.js           # Button handler
│   └── package.json       # Minimal dependencies
├── scripts/
│   ├── build-triager.sh   # Build triager package
│   ├── build-slack-interactions.sh
│   └── build-all.sh       # Build both
├── dist/
│   ├── triager.zip        # Deployable packages (generated)
│   └── slack-interactions.zip
├── claudedocs/
│   ├── SUMMARY.md         # Executive summary
│   ├── infrastructure-design.md
│   ├── cost-analysis.md
│   └── ...                # Detailed documentation
├── DEPLOYMENT.md          # Deployment guide
└── README-TRIAGER.md      # This file

../terraform/
├── modules/alarm-triager/
│   ├── main.tf            # S3, Lambda, API Gateway, IAM
│   ├── variables.tf
│   └── outputs.tf
└── envs/alarm-triager/staging/
    ├── main.tf            # Staging environment
    ├── variables.tf
    ├── outputs.tf
    └── terraform.tfvars   # Configuration (create from .example)
```

## Configuration

### Environment Variables (Triager Lambda)
- `SCREENSHOTS_BUCKET` - S3 bucket for screenshots (auto-configured)
- `APP_HEALTH_URL` - Application health check endpoint
- `DATADOG_API_KEY` - Datadog API key
- `DATADOG_APP_KEY` - Datadog application key
- `DATADOG_SITE` - Datadog site (datadoghq.com, etc)
- `APP_SERVICE_NAME` - Service name in Datadog
- `SLACK_BOT_TOKEN` - Slack bot OAuth token
- `AWS_REGION_NAME` - AWS region (auto-configured)

### Environment Variables (Existing Alarm Lambda)
- `TRIAGER_FUNCTION_NAME` - Name of triager Lambda (enables triage)
- `SLACK_CHANNEL` - Slack channel for alarms (default: #alerts)

## Cost

**Expected: ~$0.32/month** (100 alarms/day)

- Lambda: $0.10 (ARM64, 1GB, 60s avg)
- S3: $0.01 (3-day lifecycle)
- API Gateway: $0.01 (HTTP API)
- Data Transfer: $0.20

**Scaling**: ~$3.20/month @ 1,000 alarms/day

See [claudedocs/cost-analysis.md](./claudedocs/cost-analysis.md) for details.

## Monitoring

### CloudWatch Alarms
- `triager-errors` - Error rate > 5 in 5 minutes
- `triager-duration` - Duration > 90 seconds
- `triager-throttles` - Any throttling detected

### Logs
```bash
# Triager execution
aws logs tail /aws/lambda/staging-responsibid-alarm-triager --follow

# Slack interactions
aws logs tail /aws/lambda/staging-responsibid-slack-interactions --follow
```

### Metrics
```bash
# Invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=staging-responsibid-alarm-triager \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## Customization

### Triage Decision Logic
Edit `triager/index.js:makeDecision()` to customize verdict criteria:

```javascript
function makeDecision(health, logs, metricRecovered) {
  // Your custom logic here
  if (customCondition) {
    return { verdict: '🎯 CUSTOM', reason: '...', severity: 'medium' };
  }
  // ...
}
```

### Button Actions
Edit `slack-interactions/index.js:handleAction()` to add escalation logic:

```javascript
case 'escalate':
  // Add PagerDuty integration
  await triggerPagerDuty(value.alarmName);
  // Add high-priority channel notification
  await postToChannel('#critical-alerts', escalationMessage);
  break;
```

### Additional Evidence
Add more data sources to `triager/index.js`:

```javascript
const [metricScreenshot, health, logs, apm] = await Promise.all([
  getMetricScreenshot(...),
  checkHealthWithPlaywright(...),
  getDatadogLogs(...),
  getDatadogAPMTrace(timestamp) // New
]);
```

## Troubleshooting

### Common Issues

**Triager not triggered**
- Check `TRIAGER_FUNCTION_NAME` env var in alarm Lambda
- Verify Lambda invoke permission exists

**Playwright timeout**
- Increase Lambda timeout (current: 120s)
- Check APP_HEALTH_URL is accessible
- Review Lambda memory (need >= 1024MB)

**Screenshots missing**
- Verify S3 bucket policy allows public read
- Check Lambda IAM role has s3:PutObject permission

**Buttons not working**
- Verify API Gateway URL in Slack app settings
- Check Slack signing secret matches
- Review API Gateway and Lambda logs

See [DEPLOYMENT.md#troubleshooting](./DEPLOYMENT.md#troubleshooting) for detailed solutions.

## Development

### Local Testing

```bash
# Build packages
./scripts/build-all.sh

# Test triager locally (requires AWS credentials)
cd triager
node -e "
const handler = require('./index').handler;
handler({
  alarmName: 'Test-CPU',
  timestamp: new Date().toISOString(),
  newState: 'ALARM',
  metric: { name: 'CPUUtilization', namespace: 'AWS/EC2', threshold: 80, statistic: 'Average' },
  region: 'us-east-1',
  slackChannel: '#test',
  slackThreadTs: '1234567890.123456'
}).then(console.log).catch(console.error);
"
```

### Update Lambda Code

```bash
# Rebuild
./scripts/build-all.sh

# Update triager
aws lambda update-function-code \
  --function-name staging-responsibid-alarm-triager \
  --zip-file fileb://dist/triager.zip

# Update Slack interactions
aws lambda update-function-code \
  --function-name staging-responsibid-slack-interactions \
  --zip-file fileb://dist/slack-interactions.zip
```

## Roadmap

- [ ] ML-based triage decision learning from false positives
- [ ] Support for Elastic Beanstalk, CodeDeploy alarms
- [ ] Historical trend analysis (compare to past 7 days)
- [ ] PagerDuty/OpsGenie integration for escalations
- [ ] Custom triage rules configuration via DynamoDB
- [ ] Triage accuracy dashboard
- [ ] Multi-region support

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide
- [claudedocs/SUMMARY.md](./claudedocs/SUMMARY.md) - Executive summary
- [claudedocs/infrastructure-design.md](./claudedocs/infrastructure-design.md) - Architecture details
- [claudedocs/cost-analysis.md](./claudedocs/cost-analysis.md) - Cost breakdown
- [claudedocs/terraform-structure.md](./claudedocs/terraform-structure.md) - Terraform details
- [claudedocs/implementation-checklist.md](./claudedocs/implementation-checklist.md) - Implementation plan

## License

MIT License (matches parent project)

## Credits

Built on top of [lambda-cloudwatch-slack](https://github.com/assertible/lambda-cloudwatch-slack)
