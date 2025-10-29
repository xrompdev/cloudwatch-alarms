const crypto = require('crypto');

// Verify Slack request signature for security
function verifySlackRequest(event) {
  const slackSignature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  const body = event.body;

  if (!slackSignature || !timestamp) {
    throw new Error('Missing Slack signature headers');
  }

  // Prevent replay attacks (request must be within 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) {
    throw new Error('Request timestamp too old');
  }

  // Verify signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(slackSignature)
  )) {
    throw new Error('Invalid Slack signature');
  }

  return true;
}

// Handle button action
function handleAction(payload) {
  const action = payload.actions[0];
  const value = JSON.parse(action.value);
  const user = payload.user;

  console.log('Action received:', {
    action: value.action,
    alarmName: value.alarmName,
    user: user.username
  });

  let responseText = '';
  let emoji = '';

  switch (value.action) {
    case 'acknowledge':
      responseText = `Acknowledged by <@${user.id}>`;
      emoji = '✅';
      break;

    case 'false_positive':
      responseText = `Marked as false positive by <@${user.id}>`;
      emoji = '🔕';
      // TODO: Store false positive for ML training
      break;

    case 'escalate':
      responseText = `🚨 Escalated by <@${user.id}>`;
      emoji = '🚨';
      // TODO: Trigger PagerDuty/OpsGenie escalation
      // TODO: Post in high-priority channel
      break;

    default:
      responseText = `Unknown action by <@${user.id}>`;
      emoji = '❓';
  }

  return {
    response_type: 'in_channel',
    replace_original: false,
    text: `${emoji} ${responseText} at ${new Date().toISOString()}`
  };
}

// Main handler
exports.handler = async (event) => {
  console.log('Interaction event received');

  try {
    // Verify request is from Slack
    verifySlackRequest(event);

    // Parse payload from form-encoded body
    const bodyParams = new URLSearchParams(event.body);
    const payloadStr = bodyParams.get('payload');

    if (!payloadStr) {
      throw new Error('No payload found in request');
    }

    const payload = JSON.parse(payloadStr);

    console.log('Payload type:', payload.type);

    // Handle different payload types
    let response;

    if (payload.type === 'block_actions') {
      response = handleAction(payload);
    } else if (payload.type === 'url_verification') {
      // Slack URL verification challenge
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: payload.challenge })
      };
    } else {
      console.warn('Unhandled payload type:', payload.type);
      response = {
        text: 'Received unknown interaction type'
      };
    }

    // Respond within 3 seconds (Slack requirement)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Interaction error:', error);

    // Still return 200 to Slack, but with error message
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Error processing interaction: ${error.message}`
      })
    };
  }
};
