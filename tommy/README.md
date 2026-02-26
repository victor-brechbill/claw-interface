# Tommy X API Client

Official X API v2 client for Tommy to browse, search, like, and follow content matching the owner's interests. This replaces the legacy browser automation system with official API calls.

## Features

- **Home Timeline Browsing**: Scans Tommy's "For You" feed for interesting content
- **Topic Search**: Searches for posts matching the owner's interests
- **Interest Matching**: Scores posts based on the owner's topics and stock tickers
- **Smart Actions**: Likes posts and follows high-quality authors (with safety limits)
- **MongoDB Integration**: Saves finds to existing `tommy_finds` and `tommy_sessions` collections
- **Rate Limiting**: Respectful API usage with configurable delays
- **Error Handling**: Retries on rate limits, graceful degradation

## Setup

### 1. Install Dependencies

```bash
cd tommy/
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your X API credentials (see Credentials section below).

### 3. Verify Installation

Test that modules load correctly:

```bash
node -e "require('./src/x-client.js'); console.log('✅ X Client OK')"
node -e "require('./src/interest-matcher.js'); console.log('✅ Interest Matcher OK')"
node -e "require('./src/db.js'); console.log('✅ Database OK')"
```

## Credentials

X API credentials are stored in Bitwarden (ID: `c4690114-6b04-45f0-ba56-b3ec002e4a76`).

To retrieve and set up credentials:

```bash
# Get Bitwarden session
export BW_SESSION=$(python3 ~/clawd/skills/passwords/scripts/decrypt.py --stdout 2>/dev/null | xargs -I{} bw unlock --raw {} 2>/dev/null)

# Get credentials
bw get item c4690114-6b04-45f0-ba56-b3ec002e4a76 | jq '.fields'
```

Required fields for `.env`:

- `X_CONSUMER_KEY` - API Key from X Developer Console
- `X_CONSUMER_SECRET` - API Key Secret
- `X_ACCESS_TOKEN` - User Access Token (for Tommy's account)
- `X_ACCESS_TOKEN_SECRET` - User Access Token Secret

## Usage

### Manual Run

```bash
cd tommy/
node src/session-runner.js
```

### Programmatic Use

```javascript
const TommySessionRunner = require("./src/session-runner");

async function runTommySession() {
  const runner = new TommySessionRunner();
  await runner.runSession();
}
```

### Via OpenClaw Cron (Recommended)

Set up a daily cron job in OpenClaw:

```json
{
  "name": "Tommy X API Session",
  "agentId": "tommy",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 10 * * *",
    "tz": "America/Detroit"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run daily X session: cd /home/ubuntu/clawd/vault/dev/repos/dashboard/tommy && node src/session-runner.js"
  }
}
```

## Configuration

All settings are configurable via environment variables:

### Session Limits (Safety)

- `MAX_LIKES_PER_SESSION=10` - Maximum posts to like per session
- `MAX_FOLLOWS_PER_SESSION=3` - Maximum users to follow per session
- `MAX_SEARCHES_PER_SESSION=5` - Maximum topic searches per session

### Rate Limiting

- `API_DELAY_MS=1500` - Milliseconds to wait between API calls
- Built-in exponential backoff on rate limits (429 responses)
- Maximum 3 retries per request

### Database

- `MONGODB_URI=mongodb://localhost:27017` - MongoDB connection string
- `MONGODB_DATABASE=agent_dashboard_prod` - Database name
- Uses existing collections: `tommy_finds`, `tommy_sessions`

## How It Works

### Phase 1: Home Timeline

1. Fetches Tommy's home timeline (max 100 posts)
2. Scores each post against the owner's interests
3. Likes top matches (up to session limit)
4. Follows authors of high-quality posts
5. Saves interesting finds to MongoDB

### Phase 2: Topic Search

1. Picks 3-5 random topics from the owner's interests
2. Searches recent posts for each topic
3. Same scoring/like/follow/save workflow
4. Tracks stats per search

### Interest Scoring

Posts are scored based on:

- **Topic matches** (2 points each) - space, AI, real estate, etc.
- **Stock ticker mentions** (3 points each) - $RKLB, $TSLA, etc.
- **Avoid patterns** (0 points) - engagement bait, spam, crypto pumps

Minimum score of 1 required to be "interesting". Score of 5+ triggers follow.

### Data Schema

Each finding saved to `tommy_finds`:

```json
{
  "postId": "1234567890",
  "authorUsername": "elonmusk",
  "authorName": "Elon Musk",
  "text": "Starship flight test successful!",
  "url": "https://x.com/elonmusk/status/1234567890",
  "createdAt": "2026-02-09T12:00:00.000Z",
  "matchedTopics": ["space", "rockets"],
  "matchedTickers": [],
  "score": 4,
  "reason": "Matched: space, rockets",
  "liked": true,
  "followed": false,
  "sessionId": "tommy_abc123_def45",
  "foundAt": "2026-02-09T12:05:00.000Z"
}
```

## Migration from Legacy System

This replaces the browser automation scripts in `/home/ubuntu/clawd/vault/tommy/scripts/`.

### What's Different

- ✅ **Official API** instead of browser automation
- ✅ **OAuth 1.0a authentication** instead of cookies
- ✅ **Faster execution** (no browser rendering)
- ✅ **More reliable** (no login detection issues)
- ✅ **Rate limiting built-in**
- ❌ **No VPN required** (was needed for browser)

### Legacy Archive

Old browser scripts are archived to:

```
/home/ubuntu/clawd/vault/tommy/legacy/scripts/
```

## Troubleshooting

### Authentication Errors

- Verify all 4 credentials are set in `.env`
- Check that Access Token has write permissions
- Ensure credentials are for the correct X account (Tommy's)

### Rate Limiting

- API calls are automatically rate limited (1.5s delay)
- 429 responses trigger exponential backoff
- Reduce session limits if hitting rate limits frequently

### Database Errors

- Verify MongoDB is running: `systemctl status mongod`
- Check database exists: `mongo agent_dashboard_prod --eval "db.stats()"`
- Ensure collections exist: `tommy_finds`, `tommy_sessions`

### Interest Matching

- Check interests file exists: `interests/owner-interests.md`
- Verify interests are loading: look for "Loaded X topics and Y tickers" in logs
- Test scoring: `node -e "const IM = require('./src/interest-matcher'); const im = new IM(); im.loadInterests().then(() => console.log(im.scorePost({text: 'SpaceX rocket launch!'})))"`

## Security

- ⚠️ **Never commit `.env`** - contains API secrets
- ✅ **`.env` is in `.gitignore`**
- ✅ **Only `.env.example` is tracked**
- 🔒 **Credentials stored in Bitwarden**

## Monitoring

Session stats are saved to `tommy_sessions` collection:

```javascript
// Get recent session stats
const db = new TommyDatabase();
await db.connect();
const sessions = await db.getRecentSessions(5);
console.log(sessions);
```

Logs show real-time progress:

```
🤖 Tommy X API Session Starting...
📱 Phase 1: Scanning home timeline...
📄 Found 47 posts in timeline
🎯 Interesting post: 1234567890 (score: 6) - Matched: space, rockets
❤️ Liked: 1234567890
👥 Followed: @spacex
✅ Timeline phase complete: 3 liked, 1 followed, 5 saved
🔍 Phase 2: Searching topics...
...
✅ Session completed successfully!
```
