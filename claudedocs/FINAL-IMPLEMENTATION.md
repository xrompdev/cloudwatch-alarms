# CloudWatch Alarm Triager - Final Implementation

## System Overview

A two-Lambda architecture for intelligent CloudWatch alarm monitoring with threaded Slack notifications and automated sanity checks.

## Architecture

### 1. Notifier Lambda (`staging-cloudwatch-slack-notifier`)
**Role**: Alarm Issuer - Creates top-level alarm notifications

**Responsibilities:**
- Receives CloudWatch alarms via SNS
- Posts alarm notification to Slack using Bot API
- Captures message timestamp for threading
- Invokes triager Lambda with timestamp

**Key Features:**
- Uses Slack Bot API for timestamp capture
- Supports both webhook and Bot API modes
- Backward compatible fallback to webhook

**Environment Variables:**
- `SLACK_BOT_TOKEN`: Bot OAuth token
- `SLACK_CHANNEL`: Channel ID (C09P8R9QCFN)
- `TRIAGER_FUNCTION_NAME`: staging-responsibid-alarm-triager
- `UNENCRYPTED_HOOK_URL`: Fallback webhook URL

### 2. Triager Lambda (`staging-responsibid-alarm-triager`)
**Role**: Sanity Check Provider - Analyzes alarms and posts threaded responses

**Responsibilities:**
- Runs parallel health checks on 6 configurable services
- Makes intelligent triage decisions
- Posts analysis as threaded reply
- Adds emoji reactions to main alarm message

**Validation Rules:**
- `slackThreadTs` is REQUIRED - will throw error if missing
- Can ONLY post as threaded replies, never top-level messages
- Double validation in both handler and posting function

**Environment Variables:**
- `SLACK_BOT_TOKEN`: Bot OAuth token
- `SLACK_CHANNEL`: Channel ID (C09P8R9QCFN)
- `HEALTH_LEGACY_WEB`: Health check URL
- `HEALTH_SERVER_GATEWAY`: Health check URL
- `HEALTH_SERVER_GRAPHQL`: Health check URL
- `HEALTH_SERVER_PAYMENT`: Health check URL
- `HEALTH_CLIENTV2`: Health check URL
- `HEALTH_QUEUE`: Health check URL
- `DATADOG_API_KEY`: For error log retrieval
- `DATADOG_APP_KEY`: For error log retrieval
- `DATADOG_SITE`: datadoghq.com
- `APP_SERVICE_NAME`: Service name for log filtering
- `SCREENSHOTS_BUCKET`: S3 bucket for screenshots
- `AWS_REGION_NAME`: us-east-1

## Message Flow

```
CloudWatch Alarm → SNS → Notifier Lambda
                            ↓
                    Post to Slack (Bot API)
                            ↓
                    Get message timestamp
                            ↓
                    Invoke Triager Lambda
                            ↓
                    Run sanity checks (parallel)
                            ↓
                    Add emoji reaction to main message
                            ↓
                    Post analysis as threaded reply
```

## Sanity Check System

### Services Monitored
1. Legacy Web
2. Server Gateway
3. Server GraphQL
4. Server Payment
5. ClientV2
6. Queue

### Health Check Process
- Parallel execution using axios with 5s timeout
- Simple HTTP GET requests
- 200 status = healthy, anything else = unhealthy
- Results displayed with clickable links to health endpoints

### Decision Logic
```javascript
- All healthy + no errors = ✅ CAN IGNORE
- Multiple services down + many errors = 🚨 CRITICAL
- Metric recovered + minimal failures = ⚠️ MONITOR
- Some services unhealthy = 🔍 INVESTIGATE
```

### Emoji Reactions
- ✅ `:white_check_mark:` - All services healthy
- ❌ `:x:` - One or more services unhealthy

## Slack Message Format

### Top-Level Message (Notifier)
- Posted by: RBAlarmResponder Bot
- Format: Standard CloudWatch alarm notification
- Has emoji reaction from triager

### Threaded Reply (Triager)
```
🤖 Alarm Triage Analysis

Alarm: [alarm-name]
Verdict: [decision]
Reason: [explanation]

Sanity Checks:
✅ Legacy Web (clickable link)
✅ Server Gateway (clickable link)
✅ Server GraphQL (clickable link)
✅ Server Payment (clickable link)
✅ ClientV2 (clickable link)
✅ Queue (clickable link)

📝 Error Logs: [count] errors in ±5min
[Link to Datadog if available]

[Interactive buttons: Acknowledge, False Positive, Escalate]
```

## Slack Bot Configuration

### Required OAuth Scopes
- `chat:write` - Post messages
- `reactions:write` - Add emoji reactions

### Bot Token
Starts with: `xoxb-17026735397-9781536839779-...`

## Testing

### Test Alarm Creation
```bash
aws cloudwatch put-metric-alarm \
  --profile staging \
  --region us-east-1 \
  --alarm-name "test-alarm" \
  --alarm-description "Test description" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:914958427285:cloudwatch-alarms-slack
```

### Trigger Test
```bash
aws cloudwatch set-alarm-state \
  --profile staging \
  --region us-east-1 \
  --alarm-name "test-alarm" \
  --state-value ALARM \
  --state-reason "Testing system"
```

### Expected Results
1. Main alarm message appears in #alerts channel
2. Emoji reaction (✅ or ❌) added to main message
3. Threaded reply with sanity checks and analysis
4. "1 reply" indicator on main message

## Build & Deploy

### Notifier
```bash
cd /home/rom/project/responsibid/cloudwatch-alarms
bash scripts/build-notifier.sh
aws lambda update-function-code \
  --profile staging \
  --region us-east-1 \
  --function-name staging-cloudwatch-slack-notifier \
  --zip-file fileb://dist/notifier.zip
```

### Triager
```bash
cd /home/rom/project/responsibid/cloudwatch-alarms
bash scripts/build-triager.sh
aws lambda update-function-code \
  --profile staging \
  --region us-east-1 \
  --function-name staging-responsibid-alarm-triager \
  --zip-file fileb://dist/triager.zip
```

## Security & Validation

### Thread-Only Enforcement
The triager has multiple validation layers to ensure it NEVER posts top-level messages:

1. **Handler validation** (line 522-525):
   ```javascript
   if (!slackThreadTs) {
     throw new Error('slackThreadTs is required - triager can only post threaded replies, not standalone messages');
   }
   ```

2. **Posting function validation** (line 454-457):
   ```javascript
   if (!threadTs) {
     throw new Error('threadTs is required - triager can only post as threaded reply');
   }
   ```

3. **Always includes thread_ts** (line 463):
   ```javascript
   thread_ts: threadTs,  // Always post as threaded reply
   ```

### Verified Behavior
The Slack API response confirms proper threading:
```json
{
  "ok": true,
  "thread_ts": "1761670475.989209",
  "parent_user_id": "U09NZFSQPNX"
}
```

## Performance Metrics

- **Sanity checks**: 6 services in parallel (~300-400ms)
- **Total triage time**: ~300-1100ms depending on external API latency
- **Health check timeout**: 5 seconds per service
- **Memory usage**: ~130MB

## Known Limitations

1. **Metric screenshots**: Currently disabled due to CloudWatch API validation errors with AVERAGE statistic
2. **Datadog integration**: May fail with "Not found" errors for some service names
3. **No Playwright**: Removed heavy browser-based health checks in favor of simple HTTP requests

## Future Enhancements

1. Configure actual service-specific health check URLs
2. Fix CloudWatch metric screenshot generation
3. Add more sophisticated triage logic based on alarm history
4. Implement alarm auto-remediation for known issues
5. Add custom service health check patterns (not just HTTP 200)

## Version History

- **v1.0**: Initial implementation with threading and sanity checks
- **v1.1**: Added clickable health check links
- **v1.2**: Enforced thread-only posting with validation
- **v1.3**: Removed debug logging, production-ready
