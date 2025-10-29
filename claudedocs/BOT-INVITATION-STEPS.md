# Bot Invitation Steps for #alerts Channel

## Issue
The Slack bot token has `chat:write.public` scope but still cannot post to #alerts channel with error: `channel_not_found`

## Root Cause
Even with `chat:write.public` scope, the bot needs to be explicitly added as a member to the channel to post messages.

## Solution Steps

### Option 1: Invite Bot via Slack UI (Recommended)
1. Open Slack and navigate to #alerts channel
2. Click the channel name at the top to open channel details
3. Click "Integrations" tab
4. Click "Add apps" button
5. Search for "ResponsiBid Alarm Bot"
6. Click "Add" to add the bot to the channel

### Option 2: Invite Bot via Slash Command
1. In Slack, navigate to #alerts channel
2. Type: `/invite @ResponsiBid Alarm Bot`
3. Press Enter
4. Confirm the invitation

### Option 3: Use Slack API (If you have admin access)
The bot token provided only has `chat:write` and `chat:write.public` scopes.
To invite the bot programmatically, you would need a user token with `channels:manage` scope.

## Verification Steps

After adding the bot, verify it can post by running this curl command:

```bash
curl -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer YOUR_SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "channel": "#alerts",
    "text": "✅ Bot successfully added to channel - alarm triaging is now enabled"
  }'
```

Expected successful response:
```json
{
  "ok": true,
  "channel": "C...",
  "ts": "...",
  "message": {...}
}
```

## Current Bot Scopes
- `chat:write` - Post messages in approved channels
- `chat:write.public` - Post messages in public channels (requires membership)

**Note**: `chat:write.public` allows posting to public channels that apps have been added to, but the app still needs to be explicitly added as a member first.

## Alternative: Use Channel ID Instead of Name

If you know the channel ID (format: `C01234ABCD`), you can use that instead of `#alerts` in the `SLACK_CHANNEL` environment variable. Channel IDs are more reliable than channel names.

To find the channel ID:
1. Right-click on #alerts channel in Slack
2. Select "Copy" → "Copy link"
3. The ID is in the URL: `https://app.slack.com/client/T0H0SMMBP/C01234ABCD`
   (The part after the last `/` is the channel ID)

Then update Lambda environment variable:
```bash
aws lambda update-function-configuration \
  --function-name staging-responsibid-alarm-triager \
  --environment "Variables={SLACK_CHANNEL=C01234ABCD,...}"
```
