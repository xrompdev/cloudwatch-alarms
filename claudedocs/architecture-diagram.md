# Alarm Triager Architecture Diagrams

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS Cloud (us-east-1)                                │
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│  │  CloudWatch  │         │     SNS      │         │   Existing   │        │
│  │    Alarm     │────────▶│    Topic     │────────▶│    Alarm     │        │
│  │   (Trigger)  │         │              │         │   Lambda     │        │
│  └──────────────┘         └──────────────┘         └──────┬───────┘        │
│                                                             │                │
│                                                             │ Invoke         │
│                                                             ▼                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Triager Lambda Function                        │   │
│  │  ┌────────────────────────────────────────────────────────────┐    │   │
│  │  │ 1. Parse CloudWatch alarm event                            │    │   │
│  │  │ 2. Launch Playwright + Chromium (from Lambda Layer)        │    │   │
│  │  │ 3. Navigate to health check URL                            │    │   │
│  │  │ 4. Capture screenshot                                      │    │   │
│  │  │ 5. Call Datadog API for metrics                            │    │   │
│  │  │ 6. Upload screenshot to S3                                 │    │   │
│  │  │ 7. Generate presigned S3 URL                               │    │   │
│  │  │ 8. Format Slack message with buttons                       │    │   │
│  │  │ 9. Post to Slack channel                                   │    │   │
│  │  └────────────────────────────────────────────────────────────┘    │   │
│  │                                                                     │   │
│  │  Config: 1024MB RAM, 120s timeout, ARM64                           │   │
│  └──────┬────────────┬────────────┬─────────────────────────────┬────┘   │
│         │            │            │                             │          │
│         │            │            │                             │          │
│         ▼            ▼            ▼                             ▼          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 ┌──────────┐     │
│  │    S3    │ │ Datadog  │ │  Slack   │                 │CloudWatch│     │
│  │  Bucket  │ │   API    │ │   API    │                 │   Logs   │     │
│  │(3-day    │ │(Metrics) │ │(Message) │                 │ (30/90d) │     │
│  │lifecycle)│ │          │ │          │                 │          │     │
│  └──────────┘ └──────────┘ └──────────┘                 └──────────┘     │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

                                    │
                                    │ User clicks button in Slack
                                    ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS Cloud (us-east-1)                                │
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│  │    Slack     │         │API Gateway   │         │    Slack     │        │
│  │  (Button     │────────▶│  HTTP API    │────────▶│ Interactions │        │
│  │   Click)     │         │POST /slack/  │         │   Lambda     │        │
│  │              │         │ interactions │         │              │        │
│  └──────────────┘         └──────────────┘         └──────┬───────┘        │
│                                                             │                │
│                                                             │                │
│  ┌─────────────────────────────────────────────────────────┘                │
│  │                                                                           │
│  │  Button Actions:                                                         │
│  │  • Acknowledge alarm (mark as seen)                                      │
│  │  • Re-run triager (invoke triager Lambda)                                │
│  │  • Snooze alarm (temporary ignore)                                       │
│  │  • Escalate alarm (PagerDuty integration)                                │
│  │                                                                           │
│  │  Config: 256MB RAM, 10s timeout, ARM64                                   │
│  └───────────────────────────────────────────────────────────────────────────┘
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Alarm Event Flow                                   │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: CloudWatch Alarm Triggered
┌──────────────────────────────────────────────────────────────┐
│ {                                                            │
│   "AlarmName": "responsibid-staging-api-high-error-rate",   │
│   "AlarmDescription": "API error rate > 5%",                 │
│   "NewStateValue": "ALARM",                                  │
│   "NewStateReason": "Threshold Crossed",                     │
│   "Trigger": {                                               │
│     "MetricName": "ErrorRate",                               │
│     "Threshold": 5.0                                         │
│   }                                                          │
│ }                                                            │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 2: SNS Topic → Existing Alarm Lambda → Triager Lambda
┌──────────────────────────────────────────────────────────────┐
│ Triager Lambda Execution                                     │
│                                                              │
│ 1. Parse alarm event                                         │
│ 2. Extract alarm details (name, reason, metrics)             │
│ 3. Determine health check URL from alarm                     │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 3: Playwright Screenshot Capture
┌──────────────────────────────────────────────────────────────┐
│ const browser = await chromium.launch({ headless: true });   │
│ const page = await browser.newPage();                        │
│ await page.goto(healthCheckUrl);                             │
│ const screenshot = await page.screenshot({ type: 'png' });   │
│ await browser.close();                                       │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 4: Datadog API Call
┌──────────────────────────────────────────────────────────────┐
│ const metrics = await datadogAPI.query({                     │
│   query: 'avg:api.error_rate{env:staging}',                  │
│   from: Date.now() - 3600000,  // Last hour                  │
│   to: Date.now()                                             │
│ });                                                          │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 5: S3 Upload
┌──────────────────────────────────────────────────────────────┐
│ const key = `alarms/${alarmName}/${timestamp}.png`;         │
│ await s3.putObject({                                         │
│   Bucket: 'responsibid-staging-alarm-screenshots',           │
│   Key: key,                                                  │
│   Body: screenshot,                                          │
│   ContentType: 'image/png',                                  │
│   Metadata: {                                                │
│     alarmName: alarmName,                                    │
│     timestamp: timestamp.toString()                          │
│   }                                                          │
│ });                                                          │
│                                                              │
│ const presignedUrl = await s3.getSignedUrl('getObject', {   │
│   Bucket: 'responsibid-staging-alarm-screenshots',           │
│   Key: key,                                                  │
│   Expires: 259200  // 3 days                                 │
│ });                                                          │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 6: Slack Message Formatting
┌──────────────────────────────────────────────────────────────┐
│ {                                                            │
│   "channel": "#alerts-staging",                              │
│   "blocks": [                                                │
│     {                                                        │
│       "type": "header",                                      │
│       "text": "🚨 ALARM: API High Error Rate"               │
│     },                                                       │
│     {                                                        │
│       "type": "section",                                     │
│       "fields": [                                            │
│         { "type": "mrkdwn", "text": "*Alarm*: ..." },        │
│         { "type": "mrkdwn", "text": "*State*: ALARM" },      │
│         { "type": "mrkdwn", "text": "*Reason*: ..." }        │
│       ]                                                      │
│     },                                                       │
│     {                                                        │
│       "type": "section",                                     │
│       "text": "*Datadog Metrics (Last Hour)*\n..."          │
│     },                                                       │
│     {                                                        │
│       "type": "image",                                       │
│       "image_url": presignedUrl,                             │
│       "alt_text": "Health check screenshot"                  │
│     },                                                       │
│     {                                                        │
│       "type": "actions",                                     │
│       "elements": [                                          │
│         { "type": "button", "text": "Acknowledge" },         │
│         { "type": "button", "text": "Re-run Triager" },      │
│         { "type": "button", "text": "Snooze 1hr" }           │
│       ]                                                      │
│     }                                                        │
│   ]                                                          │
│ }                                                            │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
Step 7: Post to Slack
┌──────────────────────────────────────────────────────────────┐
│ Slack Channel: #alerts-staging                               │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ 🚨 ALARM: API High Error Rate                          │  │
│ │                                                        │  │
│ │ Alarm: responsibid-staging-api-high-error-rate         │  │
│ │ State: ALARM                                           │  │
│ │ Reason: Threshold Crossed: 5.2% > 5%                   │  │
│ │                                                        │  │
│ │ Datadog Metrics (Last Hour):                           │  │
│ │ • Error Rate: 5.2% (↑2.1% from baseline)               │  │
│ │ • Latency P95: 1250ms (↑15% from baseline)             │  │
│ │ • Request Count: 45,238 (normal)                       │  │
│ │                                                        │  │
│ │ [Screenshot of health check page]                      │  │
│ │                                                        │  │
│ │ [Acknowledge] [Re-run Triager] [Snooze 1hr]            │  │
│ └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Component Interactions                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│ CloudWatch   │
│   Alarm      │
└──────┬───────┘
       │ 1. Alarm triggered
       ▼
┌──────────────┐
│     SNS      │
│    Topic     │
└──────┬───────┘
       │ 2. Notify subscribers
       ▼
┌──────────────────┐
│   Existing       │
│  Alarm Lambda    │◀────────────────────────┐
└──────┬───────────┘                         │
       │ 3. Invoke triager                   │
       ▼                                     │
┌────────────────────────────────────────────┴───────┐
│           Triager Lambda                           │
│  ┌──────────────────────────────────────────────┐  │
│  │ Lambda Layer: Playwright + Chromium (180MB)  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Function Code (5MB)                          │  │
│  │ • index.js (main handler)                    │  │
│  │ • screenshot.js (Playwright logic)           │  │
│  │ • datadog.js (API integration)               │  │
│  │ • slack.js (message formatting)              │  │
│  │ • s3.js (upload logic)                       │  │
│  └──────────────────────────────────────────────┘  │
└────┬───────┬───────┬───────┬───────────────────────┘
     │       │       │       │
     │ 4a    │ 4b    │ 4c    │ 4d
     ▼       ▼       ▼       ▼
┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────────────┐
│Playwright│ │Datadog │ │   S3    │ │    Slack     │
│Screenshot│ │  API   │ │ Bucket  │ │     API      │
│(Internet)│ │(HTTPS) │ │(Upload) │ │  (Message)   │
└──────────┘ └────────┘ └─────────┘ └──────────────┘
                                            │
                                            │ 5. User action
                                            ▼
                                    ┌────────────────┐
                                    │  Slack Button  │
                                    │     Click      │
                                    └────────┬───────┘
                                             │ 6. POST request
                                             ▼
                                    ┌────────────────┐
                                    │  API Gateway   │
                                    │   HTTP API     │
                                    └────────┬───────┘
                                             │ 7. Invoke
                                             ▼
                                    ┌────────────────────┐
                                    │  Slack Interactions│
                                    │      Lambda        │
                                    │                    │
                                    │ • Verify signature │
                                    │ • Parse action     │
                                    │ • Execute handler  │
                                    │ • Update Slack msg │
                                    └────────────────────┘
```

## Cost Breakdown Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Monthly Cost Breakdown ($0.32/month)                     │
└─────────────────────────────────────────────────────────────────────────────┘

                Triager Lambda
               ██████████████████████ $0.21 (66%)
                    │
                    ├─ Compute: 3,000 invocations × 120s × 1024MB
                    └─ Requests: 3,000 requests

     CloudWatch Logs
     ████████████ $0.09 (28%)
          │
          ├─ Ingestion: ~150MB @ $0.50/GB
          └─ Storage: 30-day retention @ $0.03/GB-month

Slack Lambda
██ $0.01 (3%)
   │
   ├─ Compute: 1,500 invocations × 10s × 256MB
   └─ Requests: 1,500 requests

S3 Storage
█ $0.003 (1%)
  │
  ├─ Storage: ~150MB @ $0.023/GB
  └─ PUT requests: 3,000 @ $0.0004/1000

API Gateway
█ $0.002 (1%)
  │
  └─ HTTP API: 1,500 requests @ $1.00/million

X-Ray Tracing
█ $0.00 (0% - Free Tier)
  │
  └─ Traces: 3,000 @ $5.00/million (first 100K free)

CloudWatch Alarms
█ $0.00 (0% - Free Tier)
  │
  └─ Alarms: 5 (first 10 free)

SNS
█ $0.00 (0% - Free Tier)
  │
  └─ Notifications: <1,000 (first 1M free)

════════════════════════════════════════════════════════════════════════════════
TOTAL: $0.32/month ($3.84/year)
```

## Scaling Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Scaling Behavior (100 → 10,000 alarms/day)                  │
└─────────────────────────────────────────────────────────────────────────────┘

100 alarms/day (Current)
┌────────────────┐
│ Lambda: 3K/mo  │  Reserved Concurrency: 5
│ Cost: $0.32/mo │  Max concurrent: 5 executions
└────────────────┘
        │
        │ 5× scale
        ▼
500 alarms/day
┌────────────────┐
│ Lambda: 15K/mo │  Reserved Concurrency: 5
│ Cost: $1.20/mo │  Queue builds during spikes
└────────────────┘
        │
        │ 2× scale
        ▼
1,000 alarms/day
┌────────────────┐
│ Lambda: 30K/mo │  Reserved Concurrency: 10
│ Cost: $2.40/mo │  Increase concurrency limit
└────────────────┘
        │
        │ 10× scale
        ▼
10,000 alarms/day
┌────────────────┐
│ Lambda: 300K/mo│  Reserved Concurrency: 25
│ Cost: $22.50/mo│  Consider SQS buffer
└────────────────┘

Scaling Limits:
• Lambda: 1,000 concurrent executions (account limit)
• S3: Unlimited requests (5,500 PUT/s per prefix)
• API Gateway: 10,000 requests/second (default)
• Slack API: 1 request/second (rate limited)

Recommended Scaling Path:
1. 0-200 alarms/day: Current design (reserved concurrency: 5)
2. 200-1,000 alarms/day: Increase concurrency to 10
3. 1,000-5,000 alarms/day: Add SQS queue for buffering
4. 5,000+ alarms/day: Consider batch processing or EC2
```

## Monitoring Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CloudWatch Dashboard: Alarm Triager                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ Triager Lambda Invocations       │  │ Triager Lambda Duration          │ │
│  │ ┌────────────────────────────┐   │  │ ┌────────────────────────────┐   │ │
│  │ │        ████                │   │  │ │  Avg: 28.5s                │   │ │
│  │ │       ████                 │   │  │ │  P95: 42.3s                │   │ │
│  │ │      ████                  │   │  │ │  P99: 67.1s                │   │ │
│  │ │     ████ ███               │   │  │ │  Max: 89.2s                │   │ │
│  │ │    ████ ███                │   │  │ │                            │   │ │
│  │ │ ██████████████████████     │   │  │ │ ────────────────────────   │   │ │
│  │ └────────────────────────────┘   │  │ └────────────────────────────┘   │ │
│  │ Last 24h: 2,847 invocations      │  │ Threshold: 100s (timeout warn)   │ │
│  └──────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ Triager Lambda Errors            │  │ S3 Bucket Size (MB)              │ │
│  │ ┌────────────────────────────┐   │  │ ┌────────────────────────────┐   │ │
│  │ │ Errors: 3 (0.1%)           │   │  │ │       ████                 │   │ │
│  │ │ Success: 2,844 (99.9%)     │   │  │ │      ████                  │   │ │
│  │ │                            │   │  │ │     ████                   │   │ │
│  │ │ Common errors:             │   │  │ │    ████                    │   │ │
│  │ │ • Playwright timeout: 2    │   │  │ │ ███████████████████████    │   │ │
│  │ │ • S3 upload failed: 1      │   │  │ └────────────────────────────┘   │ │
│  │ └────────────────────────────┘   │  │ Current: 147MB (3-day window)    │ │
│  └──────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ API Gateway Requests             │  │ Estimated Monthly Cost           │ │
│  │ ┌────────────────────────────┐   │  │ ┌────────────────────────────┐   │ │
│  │ │        ██                  │   │  │ │ Current month: $0.28       │   │ │
│  │ │       ███                  │   │  │ │ Projected: $0.32           │   │ │
│  │ │      ███                   │   │  │ │ Budget: $10.00             │   │ │
│  │ │     ███ ██                 │   │  │ │ Remaining: 97%             │   │ │
│  │ │ ████████████████           │   │  │ │                            │   │ │
│  │ └────────────────────────────┘   │  │ │ ████░░░░░░░░░░░░░░░░       │   │ │
│  │ Last 24h: 1,423 requests         │  │ └────────────────────────────┘   │ │
│  │ 5xx errors: 0 (0%)               │  │ All costs well within budget     │ │
│  └──────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Summary

These diagrams provide visual representations of:

1. **High-Level Architecture**: Complete system flow from CloudWatch alarm to Slack notification
2. **Data Flow**: Detailed step-by-step data transformation through the system
3. **Component Interactions**: How each component communicates with others
4. **Cost Breakdown**: Visual representation of where money is spent
5. **Scaling Behavior**: How the system handles increased load
6. **Monitoring Dashboard**: What operational metrics to track

All diagrams support the infrastructure design documented in:
- `/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/infrastructure-design.md`
- `/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/cost-analysis.md`
- `/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/SUMMARY.md`
