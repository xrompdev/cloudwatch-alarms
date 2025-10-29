# Alarm Triager Implementation Checklist

## Phase 1: Infrastructure Design (COMPLETED)

- [x] Analyze existing Terraform patterns
- [x] Design cost-efficient architecture
- [x] Answer DevOps architecture questions
- [x] Create infrastructure documentation
- [x] Estimate costs and ROI
- [x] Define Terraform module structure

## Phase 2: Local Development & Testing

### 2.1 Triager Lambda Development
- [ ] Create `lambda/triager/` directory structure
- [ ] Implement Playwright screenshot logic
  - [ ] Launch headless Chromium browser
  - [ ] Navigate to health check URL
  - [ ] Capture screenshot with proper viewport settings
  - [ ] Handle timeouts and errors
- [ ] Implement Datadog API integration
  - [ ] Fetch alarm metrics from Datadog
  - [ ] Parse relevant data (error rates, latency, etc.)
  - [ ] Handle API rate limits and errors
- [ ] Implement S3 upload logic
  - [ ] Generate presigned URLs for Slack
  - [ ] Upload screenshot with proper metadata
  - [ ] Handle upload errors and retries
- [ ] Implement Slack notification logic
  - [ ] Format rich Slack message with buttons
  - [ ] Include screenshot URL
  - [ ] Add context from CloudWatch alarm
  - [ ] Add context from Datadog metrics
- [ ] Add structured logging (JSON format)
- [ ] Add error handling and retries
- [ ] Write unit tests
  - [ ] Mock Playwright browser
  - [ ] Mock S3 upload
  - [ ] Mock Datadog API
  - [ ] Mock Slack API
  - [ ] Test error scenarios

### 2.2 Slack Interactions Lambda Development
- [ ] Create `lambda/slack-interactions/` directory structure
- [ ] Implement Slack signature verification
- [ ] Implement button action handlers
  - [ ] Acknowledge alarm (mark as seen)
  - [ ] Re-run triager (invoke triager Lambda)
  - [ ] Snooze alarm (temporary ignore)
  - [ ] Escalate alarm (PagerDuty integration)
- [ ] Add structured logging
- [ ] Add error handling
- [ ] Write unit tests
  - [ ] Verify Slack signature validation
  - [ ] Test each button action
  - [ ] Test error scenarios

### 2.3 Local Testing
- [ ] Install dependencies
  ```bash
  cd cloudwatch-alarms/lambda/triager
  npm install playwright-core playwright-chromium aws-sdk @slack/web-api
  ```
- [ ] Create test harness (`test-local.js`)
- [ ] Test Playwright screenshot capture
- [ ] Test S3 upload (use LocalStack or actual S3)
- [ ] Test Datadog API calls
- [ ] Test Slack message formatting
- [ ] Test end-to-end flow with sample CloudWatch alarm event
- [ ] Measure execution time and memory usage
- [ ] Validate screenshot quality

## Phase 3: Terraform Module Implementation

### 3.1 Create Module Structure
- [ ] Create `terraform/modules/alarm-triager/` directory
- [ ] Create module files:
  - [ ] `main.tf` (module metadata)
  - [ ] `iam.tf` (IAM roles and policies)
  - [ ] `s3.tf` (screenshot bucket)
  - [ ] `lambda-triager.tf` (triager Lambda)
  - [ ] `lambda-slack.tf` (Slack interactions Lambda)
  - [ ] `api-gateway.tf` (HTTP API)
  - [ ] `monitoring.tf` (CloudWatch alarms)
  - [ ] `variables.tf` (input variables)
  - [ ] `outputs.tf` (module outputs)

### 3.2 Implement Resources
- [ ] S3 bucket with 3-day lifecycle policy
- [ ] Lambda IAM roles with least privilege
- [ ] Triager Lambda function
  - [ ] Configuration (memory, timeout, architecture)
  - [ ] Environment variables
  - [ ] Reserved concurrency
  - [ ] X-Ray tracing
  - [ ] CloudWatch Logs
- [ ] Slack interactions Lambda function
- [ ] Lambda layer for Playwright
- [ ] API Gateway HTTP API
  - [ ] Lambda integration
  - [ ] POST /slack/interactions route
  - [ ] CORS configuration
- [ ] CloudWatch alarms for monitoring
  - [ ] Lambda errors alarm
  - [ ] Lambda duration alarm
  - [ ] Lambda throttles alarm
  - [ ] S3 bucket size alarm
  - [ ] API Gateway 5xx errors alarm
- [ ] SNS topic for ops alerts

### 3.3 Create Environment Configuration
- [ ] Create `terraform/envs/alarm-triager/` directory
- [ ] Create environment files:
  - [ ] `main.tf` (root module)
  - [ ] `variables.tf` (variable definitions)
  - [ ] `outputs.tf` (output values)
  - [ ] `staging.tfvars` (staging config)
  - [ ] `prod.tfvars` (production config)
  - [ ] `Makefile` (workspace management)

### 3.4 Create Build Scripts
- [ ] Create `scripts/build-lambda.sh`
  - [ ] Copy Lambda code
  - [ ] Install production dependencies
  - [ ] Create deployment zip
- [ ] Create `scripts/build-layer.sh`
  - [ ] Install Playwright for ARM64
  - [ ] Create layer zip
- [ ] Create `scripts/test-local.sh`
  - [ ] Run local tests
  - [ ] Validate Lambda package sizes
- [ ] Make scripts executable

## Phase 4: Staging Deployment

### 4.1 Prepare Secrets
- [ ] Store secrets in AWS Secrets Manager or environment variables
  - [ ] Datadog API key
  - [ ] Datadog application key
  - [ ] Slack bot token
  - [ ] Slack signing secret
- [ ] Update staging.tfvars with secret ARNs
- [ ] Test secret retrieval

### 4.2 Build Lambda Packages
- [ ] Run `make build` to create deployment packages
- [ ] Verify package sizes (< 250MB combined)
- [ ] Test Lambda locally with sam local or docker

### 4.3 Initialize Terraform
- [ ] Navigate to `terraform/envs/alarm-triager/`
- [ ] Run `make init-staging`
- [ ] Verify backend configuration
- [ ] Create staging workspace

### 4.4 Deploy Infrastructure
- [ ] Run `make plan-staging`
- [ ] Review Terraform plan carefully
  - [ ] Verify resource names
  - [ ] Check IAM policies (least privilege)
  - [ ] Validate lifecycle policies
  - [ ] Check Lambda configurations
- [ ] Run `make staging`
- [ ] Wait for deployment to complete
- [ ] Capture output values (Lambda ARNs, S3 bucket, API endpoint)

### 4.5 Validate Deployment
- [ ] Check S3 bucket created with lifecycle policy
  ```bash
  aws s3 ls s3://responsibid-staging-alarm-screenshots
  aws s3api get-bucket-lifecycle-configuration --bucket responsibid-staging-alarm-screenshots
  ```
- [ ] Check Lambda functions deployed
  ```bash
  aws lambda get-function --function-name responsibid-staging-alarm-triager
  aws lambda get-function --function-name responsibid-staging-slack-interactions
  ```
- [ ] Check Lambda layer attached
  ```bash
  aws lambda list-layers
  ```
- [ ] Check API Gateway endpoint created
  ```bash
  aws apigatewayv2 get-apis
  ```
- [ ] Check CloudWatch alarms created
  ```bash
  aws cloudwatch describe-alarms --alarm-names responsibid-staging-triager-lambda-errors
  ```

## Phase 5: Integration Testing (Staging)

### 5.1 Manual Lambda Invocation
- [ ] Create test event (`test-cloudwatch-alarm.json`)
- [ ] Invoke triager Lambda manually
  ```bash
  aws lambda invoke \
    --function-name responsibid-staging-alarm-triager \
    --payload file://test-cloudwatch-alarm.json \
    --region us-east-1 \
    output.json
  ```
- [ ] Check CloudWatch Logs for execution details
  ```bash
  aws logs tail /aws/lambda/responsibid-staging-alarm-triager --follow
  ```
- [ ] Verify screenshot uploaded to S3
- [ ] Verify Slack message posted
- [ ] Check Datadog API calls in logs

### 5.2 S3 Lifecycle Testing
- [ ] Upload test screenshots with timestamps
- [ ] Wait 3 days
- [ ] Verify objects automatically deleted
- [ ] Check lifecycle policy effectiveness

### 5.3 API Gateway Testing
- [ ] Get API Gateway endpoint from Terraform output
- [ ] Test POST /slack/interactions with curl
  ```bash
  curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/slack/interactions \
    -H "Content-Type: application/json" \
    -d '{"type":"block_actions","actions":[{"action_id":"acknowledge"}]}'
  ```
- [ ] Check Slack Lambda logs
- [ ] Verify response handling

### 5.4 End-to-End Flow Testing
- [ ] Trigger real CloudWatch alarm
- [ ] Verify existing alarm Lambda invokes triager Lambda
- [ ] Check triager Lambda execution
  - [ ] Screenshot captured
  - [ ] Datadog metrics fetched
  - [ ] S3 upload successful
  - [ ] Slack message posted with buttons
- [ ] Click Slack button
- [ ] Verify API Gateway invokes Slack Lambda
- [ ] Verify button action executed

### 5.5 Error Scenario Testing
- [ ] Test with invalid health check URL (timeout)
- [ ] Test with S3 upload failure (incorrect permissions)
- [ ] Test with Datadog API error (rate limit)
- [ ] Test with Slack API error
- [ ] Test with Lambda timeout (exceed 120s)
- [ ] Test with concurrent invocations (hit reserved concurrency limit)
- [ ] Verify error handling and CloudWatch alarms triggered

## Phase 6: Monitoring & Validation (Staging)

### 6.1 CloudWatch Monitoring
- [ ] Create CloudWatch dashboard
  - [ ] Lambda invocations (triager + Slack)
  - [ ] Lambda duration (avg, p95, p99)
  - [ ] Lambda errors
  - [ ] Lambda throttles
  - [ ] S3 bucket size
  - [ ] API Gateway requests
  - [ ] API Gateway 5xx errors
- [ ] Validate CloudWatch alarms
  - [ ] Trigger test alarm (manually set alarm state)
  - [ ] Verify SNS notification sent to ops email
  - [ ] Fix any alarm configuration issues

### 6.2 X-Ray Tracing
- [ ] Open X-Ray console
- [ ] View trace for triager Lambda execution
- [ ] Analyze service map
  - [ ] Lambda → S3
  - [ ] Lambda → Datadog API
  - [ ] Lambda → Slack API
- [ ] Check for cold start latency
- [ ] Identify any bottlenecks

### 6.3 Cost Monitoring
- [ ] Set up AWS Budget for alarm-triager
  - [ ] Monthly budget: $10
  - [ ] Alert at 50%, 80%, 100%
- [ ] Enable Cost Anomaly Detection
- [ ] Review Cost Explorer
  - [ ] Filter by tag: Project=alarm-triager
  - [ ] Check daily costs
  - [ ] Validate against estimates
- [ ] Monitor for 1 week

### 6.4 Performance Optimization
- [ ] Review Lambda CloudWatch Insights
  - [ ] Memory utilization (is 1024MB oversized?)
  - [ ] Cold start frequency
  - [ ] Duration distribution
- [ ] Adjust Lambda memory if needed
  - [ ] Test with 896MB
  - [ ] Measure performance impact
  - [ ] Update if cost savings worthwhile
- [ ] Review S3 storage
  - [ ] Average screenshot size
  - [ ] Lifecycle effectiveness
  - [ ] Presigned URL TTL

## Phase 7: Production Deployment

### 7.1 Pre-Production Validation
- [ ] Review staging metrics (1 week minimum)
  - [ ] Success rate > 99%
  - [ ] Average duration < 30 seconds
  - [ ] No critical errors
  - [ ] Cost within budget
- [ ] Document any issues found in staging
- [ ] Fix any bugs or configuration issues
- [ ] Update production configuration based on learnings

### 7.2 Production Secrets
- [ ] Create production secrets in AWS Secrets Manager
  - [ ] Datadog API key (production)
  - [ ] Datadog application key (production)
  - [ ] Slack bot token (production channel)
  - [ ] Slack signing secret (production)
- [ ] Update prod.tfvars with secret references
- [ ] Test secret retrieval in production account

### 7.3 Production Deployment
- [ ] Rebuild Lambda packages with production config
- [ ] Initialize production backend
  ```bash
  make init-prod
  ```
- [ ] Plan production deployment
  ```bash
  make plan-prod
  ```
- [ ] Review plan with team
- [ ] Deploy to production
  ```bash
  make prod
  ```
- [ ] Verify deployment
  - [ ] Check all resources created
  - [ ] Verify Lambda functions accessible
  - [ ] Test manual invocation
  - [ ] Verify Slack channel correct

### 7.4 Production Integration
- [ ] Update existing alarm Lambda to invoke triager
  - [ ] Add IAM permission for invocation
  - [ ] Update Lambda code to call triager
  - [ ] Deploy updated alarm Lambda
- [ ] Configure Slack app for production
  - [ ] Set API Gateway endpoint as Request URL
  - [ ] Enable interactive components
  - [ ] Test button interactions
- [ ] Enable CloudWatch alarms
- [ ] Set up ops alert subscriptions

### 7.5 Production Validation
- [ ] Trigger test alarm in production
- [ ] Verify end-to-end flow works
- [ ] Check Slack notifications
- [ ] Test button interactions
- [ ] Monitor for 24 hours

## Phase 8: Documentation & Handoff

### 8.1 Operational Documentation
- [ ] Create runbook for common issues
  - [ ] Triager Lambda failures
  - [ ] S3 upload errors
  - [ ] Slack API errors
  - [ ] Datadog API rate limits
- [ ] Document rollback procedures
- [ ] Create troubleshooting guide
- [ ] Document monitoring dashboards

### 8.2 Maintenance Documentation
- [ ] Document deployment process
- [ ] Create dependency update schedule
  - [ ] Weekly: npm audit for vulnerabilities
  - [ ] Monthly: Playwright version updates
  - [ ] Quarterly: Node.js runtime updates
- [ ] Document secret rotation process
- [ ] Create disaster recovery plan

### 8.3 Team Training
- [ ] Walk through infrastructure with team
- [ ] Demonstrate deployment process
- [ ] Show monitoring dashboards
- [ ] Review alerting and escalation
- [ ] Document on-call procedures

## Phase 9: Ongoing Maintenance

### Weekly Tasks
- [ ] Review CloudWatch Logs for errors
- [ ] Check S3 bucket size trends
- [ ] Monitor Lambda duration trends
- [ ] Review cost in AWS Cost Explorer
- [ ] Check for npm security advisories

### Monthly Tasks
- [ ] Review Lambda CloudWatch Insights
- [ ] Optimize Lambda memory allocation if needed
- [ ] Update dependencies (npm update)
- [ ] Review and rotate secrets
- [ ] Test disaster recovery procedures
- [ ] Review cost trends and forecast

### Quarterly Tasks
- [ ] Performance optimization review
  - [ ] Lambda cold start analysis
  - [ ] S3 lifecycle effectiveness
  - [ ] Datadog API caching opportunities
- [ ] Security audit
  - [ ] Dependency vulnerability scan
  - [ ] IAM policy review (least privilege)
  - [ ] Secret access audit
- [ ] Disaster recovery drill
  - [ ] Test Terraform state restore
  - [ ] Test Lambda rollback
  - [ ] Validate monitoring alerts

## Success Criteria

### Technical Metrics
- [ ] Success rate > 99% (< 1% failures)
- [ ] Average execution time < 30 seconds
- [ ] P95 execution time < 60 seconds
- [ ] Cold start rate < 10%
- [ ] S3 lifecycle working (objects deleted after 3 days)
- [ ] Zero security vulnerabilities in dependencies

### Operational Metrics
- [ ] Monthly cost < $1 (well under budget)
- [ ] Zero critical outages
- [ ] < 5 minutes mean time to detection (MTTD)
- [ ] < 30 minutes mean time to resolution (MTTR)
- [ ] CloudWatch alarms effective (no false positives)

### Business Metrics
- [ ] 100% of CloudWatch alarms triaged automatically
- [ ] Screenshots provide actionable context
- [ ] Datadog metrics add value to alarm investigation
- [ ] Slack buttons reduce manual work
- [ ] Team satisfaction with alarm workflow

## Risk Mitigation

### High Risk Items
- [ ] **Lambda timeout (120s)**: Monitor duration, optimize if needed
- [ ] **S3 costs**: 3-day lifecycle prevents runaway storage costs
- [ ] **Concurrent invocations**: Reserved concurrency (5) prevents cost overruns
- [ ] **Playwright stability**: Robust error handling and retries
- [ ] **Secrets exposure**: Use AWS Secrets Manager, never log secrets

### Rollback Plan
- [ ] Document Terraform state rollback procedure
- [ ] Document Lambda version rollback
- [ ] Keep previous Lambda versions for 7 days
- [ ] Test rollback in staging environment
- [ ] Document emergency contacts

## Notes

- All secrets should be passed as environment variables or stored in AWS Secrets Manager
- Never commit secrets to version control
- Test thoroughly in staging before production deployment
- Monitor costs daily for first week after production deployment
- Set up budget alerts before deployment
- Document all decisions and trade-offs for future reference

## Timeline Estimate

- Phase 1: Infrastructure Design - **COMPLETED**
- Phase 2: Local Development - **3-5 days**
- Phase 3: Terraform Implementation - **2-3 days**
- Phase 4: Staging Deployment - **1 day**
- Phase 5: Integration Testing - **2-3 days**
- Phase 6: Monitoring & Validation - **7 days**
- Phase 7: Production Deployment - **1 day**
- Phase 8: Documentation - **2 days**

**Total: ~3-4 weeks** (includes 1 week staging validation)

## Contact & Support

- Infrastructure questions: DevOps team
- Lambda development: Backend team
- Slack integration: Platform team
- Cost questions: FinOps team
- Security review: Security team

## Related Documentation

- [Infrastructure Design](/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/infrastructure-design.md)
- [Cost Analysis](/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/cost-analysis.md)
- [Terraform Structure](/home/rom/project/responsibid/cloudwatch-alarms/claudedocs/terraform-structure.md)
- Existing alarm Lambda: `/home/rom/project/responsibid/cloudwatch-alarms/index.js`
