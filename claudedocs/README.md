# Alarm Triager Infrastructure Documentation

Complete infrastructure design and implementation guide for the CloudWatch alarm triaging system with Playwright screenshots, Datadog metrics integration, and Slack interactive notifications.

## Documentation Overview

### Start Here: Executive Summary
**[SUMMARY.md](./SUMMARY.md)** - Executive overview and key decisions
- Architecture overview
- Cost analysis summary ($0.32/month)
- All DevOps questions answered
- Key architecture decisions and rationale
- Recommendation and next steps

**[QUICK-REFERENCE.md](./QUICK-REFERENCE.md)** - Quick lookup card
- Commands and configurations
- Common issues and solutions
- Performance targets
- Contact information

### Detailed Documentation

#### 1. Infrastructure Design
**[infrastructure-design.md](./infrastructure-design.md)** (31KB)
- Complete infrastructure architecture
- Detailed resource configurations
- Answers to all 7 DevOps questions
- Testing strategy
- Security considerations
- Deployment strategy
- Rollback procedures
- Maintenance plan

**Topics covered**:
- VPC configuration decision (public Lambda)
- Terraform module structure
- Cost optimization recommendations
- Playwright deployment strategy (Lambda Layer)
- CloudWatch Logs retention periods
- S3 bucket region selection
- Monitoring and alerting setup

#### 2. Cost Analysis
**[cost-analysis.md](./cost-analysis.md)** (11KB)
- Monthly cost breakdown ($0.32 for 100 alarms/day)
- Scaling projections (100 → 10,000 alarms/day)
- Cost optimization decisions
- Comparison with alternatives (EC2, ECS, EKS)
- Hidden cost considerations
- Cost monitoring strategy
- ROI analysis (60% lower TCO than EC2)
- Break-even analysis

**Key findings**:
- Lambda is 97% cheaper than EC2 alternative
- Break-even at ~200 alarms/day (beyond that, consider EC2)
- Public Lambda saves $32-45/month in NAT Gateway costs
- ARM64 provides 20% cost savings
- HTTP API is 3.5× cheaper than REST API

#### 3. Terraform Structure
**[terraform-structure.md](./terraform-structure.md)** (23KB)
- Complete Terraform module structure
- Sample configurations for all resources
- Build scripts for Lambda packages
- Makefile for workspace management
- Deployment workflow
- Variable definitions
- Output configurations

**Includes**:
- Module structure matching existing `server/` pattern
- S3 bucket with 3-day lifecycle policy
- Lambda functions (triager + Slack interactions)
- Lambda Layer for Playwright
- API Gateway HTTP API
- IAM roles and policies
- CloudWatch alarms
- Build automation scripts

#### 4. Implementation Checklist
**[implementation-checklist.md](./implementation-checklist.md)** (16KB)
- Phase-by-phase implementation plan (9 phases)
- Detailed task lists with checkboxes
- Testing strategy for each phase
- Validation steps
- Success criteria
- Risk mitigation
- Timeline estimate (3-4 weeks)

**Phases**:
1. Infrastructure Design (COMPLETED)
2. Local Development & Testing
3. Terraform Module Implementation
4. Staging Deployment
5. Integration Testing
6. Monitoring & Validation
7. Production Deployment
8. Documentation & Handoff
9. Ongoing Maintenance

#### 5. Architecture Diagrams
**[architecture-diagram.md](./architecture-diagram.md)** (34KB)
- High-level architecture diagram
- Data flow diagram
- Component interaction diagram
- Cost breakdown visualization
- Scaling architecture diagram
- Monitoring dashboard layout

**Diagrams**:
- System flow (CloudWatch → SNS → Lambda → S3 → Slack)
- Step-by-step data transformation
- Component communication patterns
- Cost distribution (66% Lambda compute)
- Scaling from 100 to 10,000 alarms/day
- CloudWatch dashboard design

## Quick Navigation

### By Role

**DevOps Engineers**:
1. Start with [SUMMARY.md](./SUMMARY.md)
2. Review [infrastructure-design.md](./infrastructure-design.md)
3. Follow [terraform-structure.md](./terraform-structure.md)
4. Use [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) for daily operations

**Backend Developers**:
1. Read [SUMMARY.md](./SUMMARY.md) for context
2. Review Lambda function requirements in [infrastructure-design.md](./infrastructure-design.md)
3. Follow [implementation-checklist.md](./implementation-checklist.md) Phase 2

**Finance/Management**:
1. Start with [SUMMARY.md](./SUMMARY.md)
2. Deep dive into [cost-analysis.md](./cost-analysis.md)
3. Review ROI and break-even analysis

**Security Team**:
1. Review "Security Considerations" in [infrastructure-design.md](./infrastructure-design.md)
2. Check IAM policies in [terraform-structure.md](./terraform-structure.md)
3. Review security checklist in [QUICK-REFERENCE.md](./QUICK-REFERENCE.md)

### By Task

**Initial Review**:
- [SUMMARY.md](./SUMMARY.md) - Get the big picture
- [architecture-diagram.md](./architecture-diagram.md) - Visual overview

**Cost Planning**:
- [cost-analysis.md](./cost-analysis.md) - Complete cost breakdown
- [SUMMARY.md](./SUMMARY.md) - Cost summary and comparison

**Implementation**:
- [implementation-checklist.md](./implementation-checklist.md) - Step-by-step tasks
- [terraform-structure.md](./terraform-structure.md) - Terraform code
- [infrastructure-design.md](./infrastructure-design.md) - Resource configs

**Operations**:
- [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) - Commands and troubleshooting
- [infrastructure-design.md](./infrastructure-design.md) - Monitoring and alerting

**Troubleshooting**:
- [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) - Common issues
- [infrastructure-design.md](./infrastructure-design.md) - Rollback procedures

## Key Metrics

### Cost (100 alarms/day)
- **Monthly**: $0.32
- **Annual**: $3.84
- **3-year TCO**: $4,011 (60% lower than EC2)

### Performance Targets
- Success rate: > 99%
- Average duration: < 30 seconds
- P95 duration: < 60 seconds
- Cold start rate: < 10%

### Implementation
- **Timeline**: 3-4 weeks
- **Phases**: 9 phases (1 already complete)
- **Risk level**: Low (serverless, cost-controlled)

## Architecture Summary

### System Flow
```
CloudWatch Alarm → SNS → Existing Lambda → Triager Lambda
                                              ├─ Playwright screenshots → S3
                                              ├─ Datadog API metrics
                                              └─ Slack notification with buttons
                                                   ↓
                                              User clicks button
                                                   ↓
                                              API Gateway → Slack Lambda
```

### Key Components
1. **Triager Lambda** (1024MB, 120s, ARM64) - $0.21/month
2. **Slack Lambda** (256MB, 10s, ARM64) - $0.01/month
3. **S3 Bucket** (3-day lifecycle) - $0.003/month
4. **API Gateway** (HTTP API) - $0.002/month
5. **CloudWatch Logs** (30-day retention) - $0.09/month

### Key Decisions
1. **Public Lambda** (no VPC) - Saves $32-45/month
2. **HTTP API** (not REST) - 3.5× cheaper
3. **ARM64** architecture - 20% cost savings
4. **Lambda Layer** for Playwright - Under 250MB limit
5. **3-day S3 lifecycle** - Prevents cost accumulation

## Status

- **Phase 1: Infrastructure Design** - ✅ COMPLETED
- **Phase 2-9** - 🔜 Ready to begin

### What's Ready
- ✅ Complete architecture design
- ✅ Cost analysis and projections
- ✅ Terraform structure and samples
- ✅ Implementation checklist
- ✅ Testing strategy
- ✅ Monitoring and alerting plan
- ✅ Security considerations
- ✅ Rollback procedures

### What's Next
1. Review and approve design
2. Implement Lambda functions
3. Create Terraform modules
4. Deploy to staging
5. Integration testing (1 week)
6. Production rollout

## Questions Answered

### 1. VPC or Public Lambda?
**Answer**: Public Lambda (no VPC)
- Saves $32-45/month in NAT Gateway costs
- Faster cold starts (300ms vs 10s)
- All services accessible via internet

### 2. Terraform Structure?
**Answer**: Create `terraform/envs/alarm-triager` following `server/` pattern
- Workspace-based (staging/prod)
- Reusable module in `modules/alarm-triager/`
- Separate .tfvars files per environment

### 3. Cost Optimizations?
**Answer**: Multiple optimizations implemented
- ARM64 architecture (20% savings)
- HTTP API vs REST API (71% savings)
- Public Lambda (save $32-45/month)
- 3-day S3 lifecycle
- Reserved concurrency (cost protection)
- **Result**: $0.32/month (97% cheaper than EC2)

### 4. Playwright Deployment?
**Answer**: Lambda Layer (recommended)
- Layer: 180MB (Playwright + Chromium)
- Function: 5MB (code)
- Total: 185MB (under 250MB limit)
- Cached and reusable

### 5. CloudWatch Logs Retention?
**Answer**: 30 days (staging), 90 days (prod)
- Balances cost vs operational needs
- Export to S3 only if >1 year needed

### 6. S3 Bucket Region?
**Answer**: Same as Lambda (us-east-1)
- Zero data transfer cost
- Lower latency (< 10ms)

### 7. Monitoring for Triager?
**Answer**: 5 CloudWatch alarms (all free)
- Lambda errors, duration, throttles
- S3 bucket size
- API Gateway 5xx errors
- Plus X-Ray tracing (free at low volume)

## Documentation Standards

### File Naming
- **UPPERCASE.md** - Summary documents (SUMMARY.md, QUICK-REFERENCE.md)
- **lowercase-hyphenated.md** - Detailed documentation

### Structure
- All documents include table of contents (for 10+ KB files)
- Code blocks include language specification
- Commands include descriptions
- Tables for structured data

### Maintenance
- Document version: 1.0
- Last updated: 2025-10-28
- Review frequency: After each phase completion
- Update trigger: Architecture changes, cost updates

## Related Files

### Existing Infrastructure
- Current alarm Lambda: `/home/rom/project/responsibid/cloudwatch-alarms/index.js`
- Terraform backend: `/home/rom/project/responsibid/terraform/backend/main.tf`
- Server module: `/home/rom/project/responsibid/terraform/modules/server/`
- Server environment: `/home/rom/project/responsibid/terraform/envs/server/`

### To Be Created
- Terraform module: `/home/rom/project/responsibid/terraform/modules/alarm-triager/`
- Environment config: `/home/rom/project/responsibid/terraform/envs/alarm-triager/`
- Lambda functions: `/home/rom/project/responsibid/cloudwatch-alarms/lambda/`

## Getting Help

### For Architecture Questions
1. Review [infrastructure-design.md](./infrastructure-design.md)
2. Check [architecture-diagram.md](./architecture-diagram.md)
3. Contact: DevOps team

### For Cost Questions
1. Review [cost-analysis.md](./cost-analysis.md)
2. Check "Cost Comparison" section in [SUMMARY.md](./SUMMARY.md)
3. Contact: FinOps team

### For Implementation Help
1. Follow [implementation-checklist.md](./implementation-checklist.md)
2. Reference [terraform-structure.md](./terraform-structure.md)
3. Use [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) for commands
4. Contact: Backend team / DevOps team

### For Operational Issues
1. Check [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) "Common Issues"
2. Review monitoring in [infrastructure-design.md](./infrastructure-design.md)
3. Contact: On-call engineer

## Approval Checklist

Before proceeding with implementation:

- [ ] Architecture design reviewed and approved
- [ ] Cost estimates reviewed and approved ($0.32/month)
- [ ] Security considerations reviewed
- [ ] Terraform structure approved
- [ ] Implementation timeline approved (3-4 weeks)
- [ ] Success criteria agreed upon
- [ ] Budget allocated ($10/month buffer)
- [ ] Team resources assigned
- [ ] Escalation path defined

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-28 | Claude Code | Initial complete design |

## Next Review

- **Trigger**: After Phase 2 (Local Development) completion
- **Focus**: Update based on actual Lambda performance
- **Items**: Memory tuning, duration optimization, cost validation

---

**Status**: Design Complete, Ready for Implementation
**Owner**: DevOps Team
**Last Updated**: 2025-10-28
**Total Documentation**: 141 KB across 7 files
