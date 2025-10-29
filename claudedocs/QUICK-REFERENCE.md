# Alarm Triager - Quick Reference Card

## At a Glance

| Item | Value |
|------|-------|
| **Monthly Cost** | $0.32 (100 alarms/day) |
| **Architecture** | Serverless (Lambda + S3 + API Gateway) |
| **Region** | us-east-1 |
| **VPC** | No (public Lambda) |
| **Implementation Time** | 3-4 weeks |
| **Status** | Design complete, ready for implementation |

## Key Resources

### Lambda Functions
```
responsibid-{env}-alarm-triager
├─ Memory: 1024MB
├─ Timeout: 120s
├─ Architecture: ARM64
├─ Concurrency: 5 (reserved)
└─ Layer: playwright-chromium (180MB)

responsibid-{env}-slack-interactions
├─ Memory: 256MB
├─ Timeout: 10s
├─ Architecture: ARM64
└─ Concurrency: 3 (reserved)
```

### S3 Bucket
```
responsibid-{env}-alarm-screenshots
├─ Storage Class: Standard
├─ Lifecycle: 3-day expiration
├─ Encryption: AES256
└─ Access: Private (presigned URLs)
```

### API Gateway
```
responsibid-{env}-slack-interactions
├─ Type: HTTP API
├─ Route: POST /slack/interactions
└─ Integration: Lambda proxy
```

## Quick Commands

### Terraform Deployment
```bash
# Navigate to environment
cd terraform/envs/alarm-triager

# Build Lambda packages
make build

# Deploy to staging
make init-staging
make plan-staging
make staging

# Deploy to production
make init-prod
make plan-prod
make prod
```

### Testing
```bash
# Invoke triager Lambda
aws lambda invoke \
  --function-name responsibid-staging-alarm-triager \
  --payload file://test-event.json \
  output.json

# Check logs
aws logs tail /aws/lambda/responsibid-staging-alarm-triager --follow

# Test API Gateway
curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/slack/interactions \
  -H "Content-Type: application/json" \
  -d '{"type":"block_actions","actions":[{"action_id":"test"}]}'
```

### Monitoring
```bash
# View CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=responsibid-staging-alarm-triager \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Check S3 bucket size
aws s3 ls s3://responsibid-staging-alarm-screenshots --recursive --summarize

# View cost
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '1 month ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost
```

## Cost Quick Reference

### Base Cost (100 alarms/day)
- Triager Lambda: $0.21
- Slack Lambda: $0.01
- S3 Storage: $0.003
- API Gateway: $0.002
- CloudWatch Logs: $0.09
- **Total: $0.32/month**

### Scaling Costs
- 500 alarms/day: $1.20/month
- 1,000 alarms/day: $2.40/month
- 5,000 alarms/day: $11.30/month
- 10,000 alarms/day: $22.50/month

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **VPC** | Public Lambda | Saves $32-45/month, faster cold starts |
| **API Type** | HTTP API | 3.5× cheaper than REST API |
| **Architecture** | ARM64 | 20% cost savings |
| **Playwright** | Lambda Layer | Stays under 250MB limit |
| **S3 Storage** | Standard + 3-day lifecycle | Optimal for short retention |
| **Concurrency** | Reserved (5/3) | Prevents cost overruns |

## Monitoring Alerts

### CloudWatch Alarms (All Free)
1. Triager Lambda Errors (> 5 in 5min)
2. Triager Lambda Duration (> 100s)
3. Triager Lambda Throttles (> 0)
4. S3 Bucket Size (> 1GB)
5. API Gateway 5xx Errors (> 5 in 5min)

### Alert Destinations
- SNS Topic: `responsibid-{env}-alarm-triager-ops`
- Email: devops+{env}@responsibid.com
- Optional: Slack integration

## Terraform Structure

```
terraform/
├── envs/
│   └── alarm-triager/
│       ├── main.tf
│       ├── staging.tfvars
│       ├── prod.tfvars
│       ├── Makefile
│       └── scripts/
│           ├── build-lambda.sh
│           └── build-layer.sh
└── modules/
    └── alarm-triager/
        ├── main.tf
        ├── iam.tf
        ├── s3.tf
        ├── lambda-triager.tf
        ├── lambda-slack.tf
        ├── api-gateway.tf
        └── monitoring.tf
```

## Environment Variables

### Triager Lambda
```bash
NODE_ENV=staging
S3_SCREENSHOTS_BUCKET=responsibid-staging-alarm-screenshots
DATADOG_API_KEY=xxx
DATADOG_APP_KEY=xxx
DATADOG_SITE=datadoghq.com
SLACK_BOT_TOKEN=xoxb-xxx
HEALTH_CHECK_URL=https://app.staging.responsibid.com/health-check
AWS_REGION=us-east-1
PLAYWRIGHT_BROWSERS_PATH=/opt/nodejs/node_modules/playwright-core/.local-browsers
```

### Slack Interactions Lambda
```bash
NODE_ENV=staging
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_SIGNING_SECRET=xxx
TRIAGER_LAMBDA_ARN=arn:aws:lambda:us-east-1:xxx:function:responsibid-staging-alarm-triager
```

## Common Issues & Solutions

### Issue: Lambda timeout (120s exceeded)
**Solution**:
- Check Playwright page load time
- Verify health check URL is responsive
- Consider increasing timeout or optimizing screenshot logic

### Issue: S3 bucket size growing unexpectedly
**Solution**:
- Verify lifecycle policy is active
- Check for lifecycle rule conflicts
- Manually clean up old objects if needed

### Issue: Slack API rate limit
**Solution**:
- Implement exponential backoff
- Batch multiple alarms into single message
- Use Slack API rate limit headers

### Issue: Datadog API errors
**Solution**:
- Verify API key and app key are valid
- Check Datadog API rate limits
- Implement caching for repeated queries

### Issue: High Lambda costs
**Solution**:
- Check reserved concurrency settings
- Review CloudWatch Logs for excessive invocations
- Verify no infinite retry loops

## Security Checklist

- [ ] Store secrets in AWS Secrets Manager
- [ ] Rotate secrets quarterly
- [ ] S3 bucket has block public access enabled
- [ ] Lambda functions use least privilege IAM roles
- [ ] API Gateway validates Slack signatures
- [ ] CloudWatch Logs encrypted
- [ ] X-Ray tracing enabled for security monitoring
- [ ] npm audit run weekly for vulnerabilities

## Rollback Procedure

### Quick Rollback (< 5 minutes)
```bash
# Switch to workspace
cd terraform/envs/alarm-triager
terraform workspace select {env}

# Rollback Lambda to previous version
aws lambda update-function-code \
  --function-name responsibid-{env}-alarm-triager \
  --s3-bucket responsibid-terraform-state \
  --s3-key lambda/triager-previous.zip

# Verify rollback
aws lambda get-function --function-name responsibid-{env}-alarm-triager
```

### Full Terraform Rollback
```bash
# List state versions
aws s3api list-object-versions \
  --bucket responsibid-terraform-state \
  --prefix {env}/alarm-triager/terraform.tfstate

# Restore previous state
aws s3api get-object \
  --bucket responsibid-terraform-state \
  --key {env}/alarm-triager/terraform.tfstate \
  --version-id {VERSION_ID} \
  terraform.tfstate.backup

# Apply previous state
terraform apply
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Success Rate | > 99% | TBD |
| Avg Duration | < 30s | TBD |
| P95 Duration | < 60s | TBD |
| P99 Duration | < 90s | TBD |
| Cold Start Rate | < 10% | TBD |
| Error Rate | < 1% | TBD |

## Contacts

| Area | Contact |
|------|---------|
| Infrastructure | DevOps team |
| Lambda Development | Backend team |
| Slack Integration | Platform team |
| Cost Questions | FinOps team |
| Security Review | Security team |
| Escalation | On-call engineer |

## Documentation Links

- [Complete Infrastructure Design](./infrastructure-design.md)
- [Detailed Cost Analysis](./cost-analysis.md)
- [Terraform Structure Guide](./terraform-structure.md)
- [Implementation Checklist](./implementation-checklist.md)
- [Executive Summary](./SUMMARY.md)
- [Architecture Diagrams](./architecture-diagram.md)

## Status Dashboard

### Implementation Progress
- [x] Phase 1: Infrastructure Design
- [ ] Phase 2: Local Development
- [ ] Phase 3: Terraform Implementation
- [ ] Phase 4: Staging Deployment
- [ ] Phase 5: Integration Testing
- [ ] Phase 6: Monitoring & Validation
- [ ] Phase 7: Production Deployment
- [ ] Phase 8: Documentation & Handoff

### Deployment Status
| Environment | Status | Last Updated |
|-------------|--------|--------------|
| Staging | Not deployed | - |
| Production | Not deployed | - |

### Health Check
| Component | Staging | Production |
|-----------|---------|------------|
| Triager Lambda | - | - |
| Slack Lambda | - | - |
| S3 Bucket | - | - |
| API Gateway | - | - |
| CloudWatch Alarms | - | - |

## Next Actions

1. **Immediate**: Review and approve infrastructure design
2. **Week 1**: Implement Lambda functions and test locally
3. **Week 2**: Create Terraform modules and deploy to staging
4. **Week 3**: Integration testing and monitoring validation
5. **Week 4**: Production deployment after staging validation

## Quick Wins

- **Cost**: $0.32/month (97% cheaper than EC2)
- **Scalability**: Handles 100-10,000 alarms/day automatically
- **Reliability**: Serverless with automatic fault tolerance
- **Maintenance**: Zero servers to manage or patch
- **Security**: Least privilege IAM, encrypted storage

## Risk Summary

| Risk | Severity | Mitigation | Status |
|------|----------|------------|--------|
| Lambda timeout | Medium | Monitor duration, reserved concurrency | Monitored |
| S3 cost overrun | Low | 3-day lifecycle policy | Implemented |
| Playwright instability | Medium | Error handling, retries | To implement |
| Secret exposure | High | Secrets Manager, no logging | To implement |
| Cost spike | Low | Reserved concurrency, budget alerts | Implemented |

---

**Document Version**: 1.0
**Last Updated**: 2025-10-28
**Status**: Design Complete, Ready for Implementation
**Owner**: DevOps Team
