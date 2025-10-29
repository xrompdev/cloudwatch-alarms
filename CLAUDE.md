# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An AWS Lambda function that processes AWS SNS notifications from various AWS services (CloudWatch, Elastic Beanstalk, CodeDeploy, CodePipeline, ElastiCache, AutoScaling) and forwards formatted notifications to Slack. The function intelligently routes different notification types to specialized handlers that format the messages with appropriate color coding and structured fields.

## Development Commands

### Setup
```bash
npm install
cp .env.example .env
# Edit .env with your AWS credentials and Slack webhook URL
```

### Testing
```bash
npm test
# Runs all test cases using node-lambda with sample SNS events from test/ directory
```

Individual test cases:
```bash
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-cloudwatch-event.json
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-elastic-beanstalk-event.json
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-codedeploy-event.json
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-codepipeline-event-stage-succeeded.json
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-elasticache-event.json
./node_modules/node-lambda/bin/node-lambda run -x test/context.json -j test/sns-autoscaling-event.json
```

### Deployment
```bash
npm run deploy
# Packages and deploys to AWS Lambda using node-lambda CLI
# Requires proper AWS credentials in .env file
```

## Architecture

### Event Processing Flow
1. **Entry Point** (`exports.handler` in index.js:413): Handles Slack webhook URL initialization (supports both encrypted KMS and unencrypted URLs)
2. **Event Router** (`processEvent` in index.js:356): Analyzes incoming SNS events and routes to appropriate handler based on:
   - EventSubscriptionArn pattern matching
   - SNS Subject text matching
   - SNS Message content matching
3. **Service Handlers**: Specialized functions for each AWS service that format notifications into Slack message structure
4. **Message Posting** (`postMessage` in index.js:10): Sends formatted message to Slack webhook URL via HTTPS POST

### Service Handler Routing Logic
The event router uses cascading if/else checks in priority order:
1. **CodePipeline** → `handleCodePipeline()` (index.js:137)
2. **Elastic Beanstalk** → `handleElasticBeanstalk()` (index.js:42)
3. **CloudWatch** → `handleCloudWatch()` (index.js:230) - identified by presence of `AlarmName` and `AlarmDescription` in message
4. **CodeDeploy** → `handleCodeDeploy()` (index.js:90)
5. **ElastiCache** → `handleElasticache()` (index.js:196)
6. **AutoScaling** → `handleAutoScaling()` (index.js:283)
7. **Catch-All** → `handleCatchAll()` (index.js:314) - default handler for unrecognized event types

### Service Match Text Configuration
Service detection patterns are configured in config.js:7-30:
- `ElasticBeanstalkNotifications`
- `CodePipelineNotifications`
- `CodeDeploy`
- `ElastiCache`
- `AutoScaling`

### Color Coding Strategy
All handlers use consistent color mapping:
- **"danger"** (red): ALARM state, FAILED status, errors, severe conditions
- **"warning"** (yellow): YELLOW/Degraded states, in-progress operations, warnings
- **"good"** (green): OK state, SUCCEEDED status, normal operations

### Slack Message Structure
All handlers return messages merged with `baseSlackMessage` using lodash `_.merge()`:
```javascript
{
  text: "*Subject*",
  attachments: [{
    color: "danger" | "warning" | "good",
    fields: [{ title: "...", value: "...", short: true|false }],
    ts: timestamp
  }]
}
```

## Environment Configuration

Required variables in `.env`:
- `UNENCRYPTED_HOOK_URL` or `KMS_ENCRYPTED_HOOK_URL`: Slack webhook URL
- `AWS_FUNCTION_NAME`: Lambda function name for deployment
- `AWS_REGION`: AWS region (default: eu-west-1)
- `AWS_ROLE`: IAM role ARN for Lambda execution
- `AWS_ACCESS_KEY_ID`: AWS credentials for deployment
- `AWS_SECRET_ACCESS_KEY`: AWS credentials for deployment

Note: If using KMS encryption, the Lambda role needs `kms:Decrypt` permission on the KMS key.

## Key Implementation Details

### Webhook URL Initialization
The handler supports three modes (index.js:413-435):
1. Cached `hookUrl` (already initialized)
2. Direct `config.slackHookUrl` (unencrypted)
3. KMS decryption of `config.kmsEncryptedHookUrl` (encrypted)

### Error Handling in postMessage
- **< 400**: Success, call `context.succeed()`
- **400-499**: Client error, log and succeed (don't retry)
- **>= 500**: Server error, call `context.fail()` to trigger Lambda retry

### CloudWatch Handler Specifics
Detects CloudWatch alarms by checking for both `AlarmName` AND `AlarmDescription` in parsed SNS message (index.js:378). Constructs detailed trigger description from metrics, thresholds, and evaluation periods.

## Testing Strategy

Test files in `test/` directory contain sample SNS events for each supported service type. The test script runs all handlers sequentially to verify formatting and processing logic. Each test uses the same context.json for Lambda execution context.

## Dependencies

- `aws-sdk`: AWS SDK for KMS decryption
- `lodash`: Object merging and utility functions
- `https`/`url`: Native Node.js modules for Slack API calls
- `node-lambda` (dev): Local Lambda execution and deployment tool
