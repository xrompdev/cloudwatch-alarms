const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudWatchClient, GetMetricWidgetImageCommand } = require('@aws-sdk/client-cloudwatch');
const https = require('https');
const axios = require('axios');
const playwright = require('playwright-aws-lambda');

const s3Client = new S3Client({ region: process.env.AWS_REGION_NAME });
const cloudwatchClient = new CloudWatchClient({ region: process.env.AWS_REGION_NAME });

// Upload screenshot to S3 and return public URL
async function uploadScreenshot(buffer, filename) {
  const bucket = process.env.SCREENSHOTS_BUCKET;
  const key = `screenshots/${Date.now()}-${filename}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
    ACL: 'public-read'
  }));

  return `https://${bucket}.s3.${process.env.AWS_REGION_NAME}.amazonaws.com/${key}`;
}

// Get CloudWatch metric screenshot using GetMetricWidgetImage API
async function getMetricScreenshot(metric, timestamp, region) {
  const startTime = new Date(new Date(timestamp) - 60*60*1000); // 1 hour before
  const endTime = new Date(new Date(timestamp) + 10*60*1000);   // 10 min after

  const widget = {
    metrics: [[metric.namespace, metric.name]],
    period: 300,
    stat: metric.statistic,
    region: region,
    title: `${metric.name} - Alarm Triggered`,
    width: 800,
    height: 400,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
    yAxis: {
      left: {
        label: metric.name
      }
    },
    annotations: {
      horizontal: [
        {
          value: metric.threshold,
          label: 'Threshold',
          color: '#d62728'
        }
      ],
      vertical: [
        {
          value: timestamp,
          label: 'Alarm',
          color: '#ff7f0e'
        }
      ]
    }
  };

  try {
    const command = new GetMetricWidgetImageCommand({
      MetricWidget: JSON.stringify(widget)
    });

    const result = await cloudwatchClient.send(command);
    const imageBuffer = Buffer.from(result.MetricWidgetImage);

    return await uploadScreenshot(imageBuffer, 'cloudwatch-metric.png');
  } catch (error) {
    console.error('Failed to get metric screenshot:', error);
    return null;
  }
}

// Simple health check via HTTP request
async function checkHealth(url, serviceName) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      validateStatus: () => true // Don't throw on any status
    });

    return {
      service: serviceName,
      url: url,
      ok: response.status === 200,
      status: response.status
    };
  } catch (err) {
    return {
      service: serviceName,
      url: url,
      ok: false,
      status: 0,
      error: err.message
    };
  }
}

// Run sanity checks on all configured services
async function runSanityChecks() {
  const healthChecks = [
    { name: 'Legacy Web', url: process.env.HEALTH_LEGACY_WEB },
    { name: 'Server Gateway', url: process.env.HEALTH_SERVER_GATEWAY },
    { name: 'Server GraphQL', url: process.env.HEALTH_SERVER_GRAPHQL },
    { name: 'Server Payment', url: process.env.HEALTH_SERVER_PAYMENT },
    { name: 'ClientV2', url: process.env.HEALTH_CLIENTV2 },
    { name: 'Queue', url: process.env.HEALTH_QUEUE }
  ];

  // Filter out services without configured URLs
  const configuredChecks = healthChecks.filter(check => check.url);

  // Run all health checks in parallel
  const results = await Promise.all(
    configuredChecks.map(check => checkHealth(check.url, check.name))
  );

  return results;
}

// Get Datadog logs
async function getDatadogLogs(timestamp, serviceName) {
  const from = new Date(new Date(timestamp) - 5*60*1000).getTime();
  const to = new Date(new Date(timestamp) + 2*60*1000).getTime();

  try {
    const response = await axios.get(
      `https://api.${process.env.DATADOG_SITE}/api/v2/logs/events/search`,
      {
        headers: {
          'DD-API-KEY': process.env.DATADOG_API_KEY,
          'DD-APPLICATION-KEY': process.env.DATADOG_APP_KEY,
          'Content-Type': 'application/json'
        },
        params: {
          'filter[query]': `service:${serviceName} status:error`,
          'filter[from]': from,
          'filter[to]': to,
          'page[limit]': 10,
          'sort': '-timestamp'
        }
      }
    );

    const logs = response.data.data || [];
    const errors = logs.map(l => ({
      timestamp: new Date(l.attributes.timestamp).toISOString(),
      message: l.attributes.message || l.attributes.attributes?.message || 'No message'
    }));

    return {
      errorCount: logs.length,
      recentErrors: errors.slice(0, 5),
      datadogUrl: `https://app.${process.env.DATADOG_SITE}/logs?from_ts=${from}&to_ts=${to}&query=service:${serviceName}%20status:error`
    };
  } catch (err) {
    console.error('Datadog error:', err.response?.data || err.message);
    return {
      errorCount: 0,
      recentErrors: [],
      error: err.message,
      datadogUrl: null
    };
  }
}

// Simple triage decision logic based on sanity checks
function makeDecision(sanityChecks, logs, metricRecovered) {
  const failedServices = sanityChecks.filter(check => !check.ok);
  const totalServices = sanityChecks.length;
  const healthyServices = totalServices - failedServices.length;

  // Critical: Multiple services down + many errors
  if (failedServices.length > 1 && logs.errorCount > 10) {
    return {
      verdict: '🚨 CRITICAL',
      reason: `${failedServices.length}/${totalServices} services down with significant errors`,
      severity: 'high',
      color: 'danger'
    };
  }

  // Can ignore: All services healthy + no errors
  if (failedServices.length === 0 && logs.errorCount === 0) {
    return {
      verdict: '✅ CAN IGNORE',
      reason: 'All services healthy, no errors detected',
      severity: 'low',
      color: 'good'
    };
  }

  // Monitor: Metric recovered + minimal failures
  if (metricRecovered && failedServices.length <= 1 && logs.errorCount < 5) {
    return {
      verdict: '⚠️ MONITOR',
      reason: 'Metric recovered, minimal service issues',
      severity: 'medium',
      color: 'warning'
    };
  }

  // Some services unhealthy
  if (failedServices.length > 0 && failedServices.length <= totalServices / 2) {
    return {
      verdict: '🔍 INVESTIGATE',
      reason: `${failedServices.length}/${totalServices} services reporting issues`,
      severity: 'medium',
      color: 'warning'
    };
  }

  // Default: needs review
  return {
    verdict: '👀 NEEDS REVIEW',
    reason: 'Inconclusive - manual review recommended',
    severity: 'medium',
    color: 'warning'
  };
}

// Add reaction to main alarm message
async function addReaction(channel, threadTs, emoji) {
  const body = JSON.stringify({
    channel: channel,
    timestamp: threadTs,
    name: emoji
  });

  const options = {
    hostname: 'slack.com',
    path: '/api/reactions.add',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (!response.ok && response.error !== 'already_reacted') {
            console.error('Reaction error:', response.error);
          }
          resolve(response);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Post to Slack thread with interactive buttons
async function postToSlackThread(channel, threadTs, triageData) {
  const { alarmName, alarmDescription, decision, sanityChecks, logs, metricScreenshot } = triageData;

  // Add reaction to main message based on sanity check results
  if (threadTs) {
    const allHealthy = sanityChecks.every(check => check.ok);
    const reaction = allHealthy ? 'white_check_mark' : 'x';

    try {
      await addReaction(channel, threadTs, reaction);
      console.log(`Added reaction :${reaction}: to main message`);
    } catch (err) {
      console.error('Failed to add reaction:', err.message);
    }
  }

  // Build blocks for rich formatting
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🤖 Alarm Triage Analysis',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Alarm:*\n${alarmName}`
        },
        {
          type: 'mrkdwn',
          text: `*Verdict:*\n${decision.verdict}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${decision.reason}`
      }
    }
  ];

  if (alarmDescription) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_${alarmDescription}_`
      }]
    });
  }

  blocks.push({ type: 'divider' });

  // Sanity Checks section
  if (sanityChecks && sanityChecks.length > 0) {
    const sanityCheckText = sanityChecks.map(check => {
      const emoji = check.ok ? ':white_check_mark:' : ':x:';
      const statusText = check.ok ? '' : ` (${check.error || 'HTTP ' + check.status})`;
      const serviceName = check.url ? `<${check.url}|${check.service}>` : check.service;
      return `${emoji} ${serviceName}${statusText}`;
    }).join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Sanity Checks:*\n${sanityCheckText}`
      }
    });
  }

  // Error logs section
  if (logs.errorCount > 0 || logs.datadogUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📝 Error Logs:*\n${logs.errorCount} errors in ±5min${logs.datadogUrl ? `\n<${logs.datadogUrl}|View in Datadog>` : ''}`
      }
    });
  }

  // Metric screenshot
  if (metricScreenshot) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📊 CloudWatch Metric:*'
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Metric'
        },
        url: metricScreenshot
      }
    });
    blocks.push({
      type: 'image',
      image_url: metricScreenshot,
      alt_text: 'CloudWatch Metric Graph'
    });
  }

  // Recent error logs
  if (logs.recentErrors && logs.recentErrors.length > 0) {
    const errorText = logs.recentErrors
      .map(e => `[${e.timestamp}] ${e.message.substring(0, 200)}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recent Errors:*\n\`\`\`${errorText}\`\`\``
      }
    });
  }

  blocks.push({ type: 'divider' });

  // Interactive buttons
  const timestamp = Date.now();
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '✅ Acknowledge',
          emoji: true
        },
        style: 'primary',
        action_id: `ack_${timestamp}`,
        value: JSON.stringify({
          action: 'acknowledge',
          alarmName,
          threadTs,
          timestamp: new Date().toISOString()
        })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔕 False Positive',
          emoji: true
        },
        action_id: `false_positive_${timestamp}`,
        value: JSON.stringify({
          action: 'false_positive',
          alarmName,
          threadTs,
          timestamp: new Date().toISOString()
        })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🚨 Escalate',
          emoji: true
        },
        style: 'danger',
        action_id: `escalate_${timestamp}`,
        value: JSON.stringify({
          action: 'escalate',
          alarmName,
          threadTs,
          timestamp: new Date().toISOString()
        })
      }
    ]
  });

  // Triager ONLY posts threaded replies, never standalone messages
  if (!threadTs) {
    throw new Error('threadTs is required - triager can only post as threaded reply');
  }

  const slackMessage = {
    channel: channel,
    text: `Triage Analysis: ${decision.verdict}`,
    blocks: blocks,
    thread_ts: threadTs,  // Always post as threaded reply
    unfurl_links: false,
    unfurl_media: false
  };

  const body = JSON.stringify(slackMessage);
  const options = {
    hostname: 'slack.com',
    path: '/api/chat.postMessage',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const response = JSON.parse(data);
        if (!response.ok) {
          reject(new Error(`Slack API error: ${response.error}`));
        } else {
          resolve(response);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Main handler
exports.handler = async (event) => {
  console.log('Triage event:', JSON.stringify(event, null, 2));

  const startTime = Date.now();

  try {
    // Extract event data
    const {
      alarmName,
      alarmDescription,
      timestamp,
      newState,
      metric,
      region,
      slackThreadTs,
      slackChannel
    } = event;

    // Validate required fields
    if (!alarmName || !timestamp || !metric || !slackChannel) {
      throw new Error('Missing required fields in event');
    }

    // slackThreadTs is REQUIRED - triager only provides sanity checks in threads, never creates alarms
    if (!slackThreadTs) {
      throw new Error('slackThreadTs is required - triager can only post threaded replies, not standalone messages');
    }

    console.log(`Triaging alarm: ${alarmName}, State: ${newState}`);

    // Gather evidence in parallel
    const [metricScreenshot, sanityChecks, logs] = await Promise.all([
      getMetricScreenshot(metric, timestamp, region),
      runSanityChecks(),
      getDatadogLogs(timestamp, process.env.APP_SERVICE_NAME)
    ]);

    console.log('Evidence gathered:', {
      metricScreenshot: !!metricScreenshot,
      sanityChecks: sanityChecks.map(c => ({ service: c.service, ok: c.ok })),
      errorCount: logs.errorCount
    });

    // Make triage decision
    const metricRecovered = newState === 'OK';
    const decision = makeDecision(sanityChecks, logs, metricRecovered);

    console.log('Triage decision:', decision.verdict);

    // Post to Slack thread
    await postToSlackThread(
      slackChannel,
      slackThreadTs,
      {
        alarmName,
        alarmDescription,
        decision,
        sanityChecks,
        logs,
        metricScreenshot
      }
    );

    const duration = Date.now() - startTime;
    console.log(`Triage complete in ${duration}ms:`, decision.verdict);

    return {
      statusCode: 200,
      body: JSON.stringify({
        verdict: decision.verdict,
        duration: duration
      })
    };

  } catch (error) {
    console.error('Triage error:', error);

    // Try to post error to Slack
    try {
      if (event.slackChannel && event.slackThreadTs) {
        await postToSlackThread(
          event.slackChannel,
          event.slackThreadTs,
          {
            alarmName: event.alarmName || 'Unknown',
            alarmDescription: event.alarmDescription,
            decision: {
              verdict: '❌ TRIAGE FAILED',
              reason: `Error: ${error.message}`,
              severity: 'error',
              color: 'danger'
            },
            sanityChecks: [],
            logs: { errorCount: 0, recentErrors: [] },
            metricScreenshot: null
          }
        );
      }
    } catch (slackError) {
      console.error('Failed to post error to Slack:', slackError);
    }

    throw error;
  }
};
