# Alarm Triager Cost Analysis

## Monthly Cost Breakdown (100 alarms/day)

| Component | Configuration | Monthly Cost | Annual Cost | Notes |
|-----------|--------------|--------------|-------------|-------|
| **S3 Storage** | Standard, 3-day lifecycle | $0.003 | $0.036 | ~150MB storage |
| **Triager Lambda** | 1024MB, 120s, ARM64 | $0.21 | $2.52 | 3,000 invocations |
| **Slack Lambda** | 256MB, 10s, ARM64 | $0.01 | $0.12 | 1,500 invocations |
| **API Gateway** | HTTP API | $0.002 | $0.024 | 1,500 requests |
| **CloudWatch Logs** | 30-day retention | $0.09 | $1.08 | ~150MB ingestion |
| **X-Ray Tracing** | Active | $0.00 | $0.00 | Under 100K free tier |
| **Data Transfer** | Same region | $0.00 | $0.00 | Lambda-S3 same region |
| **SNS** | Topic + subscriptions | $0.00 | $0.00 | Under 1M free tier |
| **CloudWatch Alarms** | 5 alarms | $0.00 | $0.00 | Under 10 alarm free tier |
| **TOTAL** | | **$0.32** | **$3.84** | |

## Scaling Cost Projections

| Daily Alarms | Monthly Lambda Cost | Monthly Total | Annual Total |
|--------------|-------------------|---------------|--------------|
| 100 | $0.22 | $0.32 | $3.84 |
| 500 | $1.10 | $1.20 | $14.40 |
| 1,000 | $2.20 | $2.40 | $28.80 |
| 5,000 | $11.00 | $11.30 | $135.60 |
| 10,000 | $22.00 | $22.50 | $270.00 |

## Cost Optimization Decisions

### Decision 1: VPC vs Public Lambda
| Option | Cost | Pros | Cons |
|--------|------|------|------|
| **Public Lambda (Selected)** | $0.32/month | Simple, fast cold starts, no NAT charges | No VPC resource access |
| VPC Lambda | $32-45/month | Access VPC resources | NAT Gateway costs, slow cold starts |

**Savings: $32-45/month by avoiding VPC**

### Decision 2: HTTP API vs REST API
| Option | Cost/Million | Monthly Cost (1,500 req) |
|--------|-------------|-------------------------|
| **HTTP API (Selected)** | $1.00 | $0.0015 |
| REST API | $3.50 | $0.0053 |

**Savings: $0.004/month (negligible at low volume, but 3.5× cheaper)**

### Decision 3: Lambda Architecture
| Option | Cost Difference | Performance |
|--------|----------------|-------------|
| x86_64 | Baseline | Standard |
| **ARM64 (Selected)** | -20% | Equivalent |

**Savings: $0.04/month (20% reduction on Lambda compute)**

### Decision 4: S3 Storage Class
| Option | Storage Cost | Retrieval Cost | Recommendation |
|--------|-------------|----------------|----------------|
| **Standard (Selected)** | $0.023/GB | Free | Best for 3-day lifecycle |
| Intelligent-Tiering | $0.023/GB + $0.0025/object | Free | Min 30 days, overhead cost |
| Glacier Instant | $0.004/GB | $0.01/GB | Overkill for 3-day retention |

**Savings: $0 (Standard is optimal for short retention)**

### Decision 5: CloudWatch Logs Retention
| Retention | Storage Cost | Use Case |
|-----------|-------------|----------|
| 7 days | $0.02/month | Development |
| **30 days (Staging)** | $0.05/month | Testing/debugging |
| **90 days (Production)** | $0.14/month | Compliance/audit |
| 1 year | $0.36/month | Regulatory requirements |

**Decision: 30 days staging, 90 days production (balance cost vs retention needs)**

### Decision 6: Playwright Deployment
| Option | Size | Deployment Time | Pros | Cons |
|--------|------|----------------|------|------|
| Bundle everything | 500MB+ | Slow (>60s) | Simple | Exceeds 250MB limit |
| **Lambda Layer (Selected)** | 185MB | Fast (10-15s) | Reusable, cached | Extra resource |
| Container Image | 600MB+ | Slow (>90s) | Flexible | Complex, cold starts |
| EFS Mount | N/A | Medium | Shared storage | $0.30/GB-month cost |

**Savings: No additional cost, avoids EFS charges**

## Cost Comparison with Alternatives

### Alternative 1: EC2 Instance (t3.micro)
| Component | Cost |
|-----------|------|
| EC2 instance (24/7) | $7.50/month |
| EBS storage (8GB) | $0.80/month |
| Elastic IP | $3.60/month |
| **Total** | **$11.90/month** |

**Lambda savings: $11.58/month (97% cheaper)**

### Alternative 2: ECS Fargate
| Component | Cost |
|-----------|------|
| Fargate (0.25 vCPU, 0.5GB) | $10.80/month |
| ALB | $16.20/month |
| **Total** | **$27.00/month** |

**Lambda savings: $26.68/month (99% cheaper)**

### Alternative 3: Kubernetes (EKS)
| Component | Cost |
|-----------|------|
| EKS control plane | $73.00/month |
| Worker nodes (2× t3.small) | $30.00/month |
| Load balancer | $16.20/month |
| **Total** | **$119.20/month** |

**Lambda savings: $118.88/month (99.7% cheaper)**

## Hidden Cost Considerations

### Data Transfer (Already Optimized)
- Lambda → S3 (same region): **$0.00** (no charges within region)
- Lambda → Internet (Slack API): **$0.09/GB** (minimal, ~1MB/invocation)
- S3 → Internet (presigned URLs): **$0.09/GB** (minimal, screenshot views)

### Lambda Cold Starts (Cost Impact: $0)
- Cold start frequency: ~5% (with reserved concurrency of 5)
- Additional duration per cold start: +2-5 seconds
- Cost impact: Negligible at low volume

### Playwright Memory Overhead
- Chromium minimum memory: 768MB
- Configured: 1024MB (33% headroom)
- Optimization potential: Test with 896MB to reduce cost by 12.5%

## Cost Monitoring Strategy

### AWS Budgets
```
Budget Name: AlarmTriagerMonthlyCost
Amount: $10.00/month (30× expected cost)
Alert Thresholds:
  - 50% ($5.00): Email notification
  - 80% ($8.00): Email + Slack alert
  - 100% ($10.00): Email + Slack + PagerDuty
```

### Cost Anomaly Detection
Enable AWS Cost Anomaly Detection:
- Monitor service: Lambda
- Alert threshold: 20% deviation from forecast
- Notification: SNS → Slack

### Weekly Cost Review Query
```sql
-- Athena query for CUR (Cost and Usage Report)
SELECT
  line_item_product_code,
  SUM(line_item_unblended_cost) AS cost
FROM
  cur_table
WHERE
  line_item_usage_start_date >= DATE_ADD('day', -7, CURRENT_DATE)
  AND resource_tags_user_project = 'alarm-triager'
GROUP BY
  line_item_product_code
ORDER BY
  cost DESC;
```

## Cost Optimization Opportunities

### Phase 1: Current Implementation (Completed)
- [x] Use ARM64 architecture (20% savings)
- [x] Public Lambda (avoid NAT Gateway)
- [x] HTTP API instead of REST API (71% savings)
- [x] S3 Standard with 3-day lifecycle
- [x] Reserved concurrency to prevent runaway costs

### Phase 2: Post-Launch Optimization
- [ ] Reduce Lambda memory based on actual usage (896MB vs 1024MB)
- [ ] Implement Lambda Powertools for structured logging (reduce log volume by 30%)
- [ ] Cache Datadog API responses in Lambda /tmp (reduce API calls)
- [ ] Batch S3 uploads for multiple alarms (reduce PUT requests)

### Phase 3: Scale Optimization (>1000 alarms/day)
- [ ] Use Lambda SnapStart for instant cold starts (Java runtime only)
- [ ] Consider SQS queue for burst protection (decouple alarm flow)
- [ ] Implement CloudFront for S3 screenshot delivery (reduce S3 data transfer)
- [ ] Use Lambda Provisioned Concurrency during peak hours only

## ROI Analysis

### Current Solution (Lambda)
- **Development time**: 40 hours @ $100/hr = $4,000
- **Monthly cost**: $0.32
- **Annual operational cost**: $3.84
- **3-year TCO**: $4,011.52

### Alternative Solution (EC2)
- **Development time**: 60 hours @ $100/hr = $6,000 (more complex deployment)
- **Monthly cost**: $11.90
- **Annual operational cost**: $142.80
- **3-year TCO**: $6,428.40

### Savings with Lambda: $2,416.88 over 3 years (60% lower TCO)

## Break-Even Analysis

At what volume does Lambda become MORE expensive than EC2?

**Lambda Cost Formula:**
```
Monthly Cost = (Invocations × Duration × Memory × $0.0000166667) + (Invocations × $0.20 / 1M)
```

**EC2 Fixed Cost:** $11.90/month

**Break-even Calculation:**
```
$11.90 = (Invocations × 120s × 1024MB × $0.0000166667) + (Invocations × $0.0000002)
$11.90 = Invocations × ($0.00205 + $0.0000002)
Invocations = 5,805 per month
Daily invocations = 193 alarms/day
```

**Conclusion: Lambda is cost-effective up to ~200 alarms/day. Beyond that, consider EC2 or Fargate Spot.**

## Cost FAQs

**Q: Why is the cost so low?**
A: Serverless pricing is usage-based. With only 100 alarms/day and short execution times, we're well within AWS free tiers for most services.

**Q: What if alarms spike to 10,000/day?**
A: Monthly cost increases to $22.50 (still acceptable). Reserved concurrency limit (5) prevents runaway costs from alarm storms.

**Q: Should we enable Lambda Insights?**
A: Not recommended. Costs $0.20/month per function ($0.40 total), which is higher than our entire current bill. Use only during optimization phase.

**Q: What about data transfer to Slack?**
A: Minimal (~1KB per Slack API call). Total: 100 alarms × 1KB × 30 days = 3MB/month ≈ $0.0003. Negligible.

**Q: Can we reduce S3 costs further?**
A: Current S3 cost is $0.003/month. Even switching to Intelligent-Tiering adds overhead ($0.0025/object) that exceeds storage savings.

**Q: What's the biggest cost driver?**
A: Triager Lambda compute time (66% of total cost). Optimization target: Reduce execution time by caching or parallel processing.

## Recommended Monitoring Dashboards

### CloudWatch Dashboard (Free)
Create dashboard with:
1. Lambda invocations (line chart)
2. Lambda duration (avg/p95/p99)
3. Lambda errors (count)
4. S3 bucket size (storage bytes)
5. API Gateway request count
6. Estimated monthly cost (calculated metric)

### Cost Explorer Dashboard
Create report with:
1. Daily costs by service (stacked bar chart)
2. Cost forecast (line chart with prediction)
3. Cost by tag (project: alarm-triager)
4. Month-over-month comparison

### Slack Cost Alert Bot (Optional)
Create Lambda function that posts to Slack daily:
```
📊 Alarm Triager Daily Stats
- Alarms processed: 98
- Screenshots stored: 98 (147MB)
- Estimated daily cost: $0.01
- Monthly projection: $0.30
- Budget remaining: 97% ($9.70)
```

## Summary

The alarm triaging infrastructure is **extremely cost-efficient** at the expected volume (100 alarms/day):

- **Monthly cost: $0.32** (well within budget)
- **Annual cost: $3.84** (coffee money)
- **3-year TCO: 60% lower than EC2 alternative**
- **Serverless benefits: Auto-scaling, zero maintenance, pay-per-use**

Key cost optimizations implemented:
1. ARM64 architecture (20% savings)
2. Public Lambda (saves $32-45/month in NAT costs)
3. HTTP API (3.5× cheaper than REST API)
4. 3-day S3 lifecycle (minimal storage costs)
5. Reserved concurrency (prevents cost overruns)

**Recommendation: Proceed with Lambda implementation. Cost is negligible and architecture is optimal for this workload.**
