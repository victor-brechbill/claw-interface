require('dotenv').config();

// X API v2 Configuration
const X_API_BASE_URL = 'https://api.x.com/2';

// Session Limits (cost-optimized: ~$0.27/session, ~$8/month at 1x daily)
const SESSION_LIMITS = {
  MAX_LIKES: parseInt(process.env.MAX_LIKES_PER_SESSION) || 3,
  MAX_FOLLOWS: parseInt(process.env.MAX_FOLLOWS_PER_SESSION) || 1,
  MAX_SEARCHES: parseInt(process.env.MAX_SEARCHES_PER_SESSION) || 1,
  MAX_TIMELINE_POSTS: 25,
  MAX_SEARCH_RESULTS: 10,
};

// API Rate Limiting (reduced cooldowns — X API v2 rate limits are per-15-min window)
const RATE_LIMITS = {
  API_DELAY_MS: parseInt(process.env.API_DELAY_MS) || 2000,       // 2s between API calls (was 5s)
  ENGAGEMENT_DELAY_MS: parseInt(process.env.ENGAGEMENT_DELAY_MS) || 5000, // 5s between likes/follows (was 10s)
  SEARCH_DELAY_MS: parseInt(process.env.SEARCH_DELAY_MS) || 3000, // 3s between searches (was using API_DELAY_MS)
  MAX_RETRIES: 3, // Exponential backoff: 2s, 4s, 8s
};

// MongoDB Configuration
const MONGODB = {
  URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
  DATABASE: process.env.MONGODB_DATABASE || 'agent_dashboard_prod',
  COLLECTIONS: {
    FINDS: 'tommy_finds',
    SESSIONS: 'tommy_sessions'
  }
};

// X API Credentials
const X_CREDENTIALS = {
  CONSUMER_KEY: process.env.X_CONSUMER_KEY,
  CONSUMER_SECRET: process.env.X_CONSUMER_SECRET,
  ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET,
  USER_ID: process.env.TOMMY_USER_ID, // Will be auto-detected if not set
};

// X API Endpoints
const API_ENDPOINTS = {
  SEARCH_RECENT: '/tweets/search/recent',
  USER_TIMELINE: (userId) => `/users/${userId}/timelines/reverse_chronological`,
  USER_LIKES: (userId) => `/users/${userId}/likes`,
  USER_FOLLOWING: (userId) => `/users/${userId}/following`,
  USER_BY_USERNAME: (username) => `/users/by/username/${username}`,
  USER_ME: '/users/me',
};

// Tweet fields to include in API requests
const TWEET_FIELDS = 'author_id,created_at,public_metrics,entities,text';
const USER_FIELDS = 'username,name,verified,public_metrics';

// X API Pricing (per resource/request)
const PRICING = {
  POST_READ: 0.005,        // per post fetched
  USER_READ: 0.010,        // per user resource fetched
  CONTENT_CREATE: 0.010,   // per post/media created
  USER_INTERACTION: 0.015, // per like/follow/etc
  DM_READ: 0.010,          // per DM event
  DM_CREATE: 0.015,        // per DM sent
  MONTHLY_BUDGET: parseFloat(process.env.X_MONTHLY_BUDGET) || 10.00,
};

// Patterns to avoid (engagement bait, spam, etc.)
const AVOID_PATTERNS = [
  /reply with/i,
  /retweet if/i,
  /follow for more/i,
  /🚨.*pump/i,
  /to the moon/i,
  /diamond hands/i,
  /lfg.*$/i,
  /follow me.*$/i,
  /check out my/i,
];

// Owner's profile for dynamic interest scanning (Fix 7)
const OWNER_PROFILE = {
  USERNAME: process.env.OWNER_X_USERNAME || 'your_handle',
  MAX_LIKES_TO_SCAN: parseInt(process.env.OWNER_LIKES_SCAN) || 20,
  MAX_TWEETS_TO_SCAN: parseInt(process.env.OWNER_TWEETS_SCAN) || 10,
  DYNAMIC_TOPIC_WEIGHT: 5,   // Points per topic from owner's activity (vs 2 for static)
  DYNAMIC_AUTHOR_BOOST: 3,   // Bonus points if author is someone owner engages with
};

// Author diversity cap (Fix 4)
const MAX_LIKES_PER_AUTHOR = parseInt(process.env.MAX_LIKES_PER_AUTHOR) || 2;

// AI Scoring Configuration
// Scoring thresholds (Tommy scores directly — no OpenAI API calls)
const AI_CONFIG = {
  MIN_SCORE_TO_LIKE: 7,
  MIN_SCORE_TO_FOLLOW: 8,
  MIN_SCORE_TO_POST: 8,
  MIN_SCORE_TO_SAVE: 5,
};

// Posting Configuration
const POSTING_CONFIG = {
  ENABLED: process.env.POSTING_ENABLED === 'true',
  MAX_PICK_POSTS_PER_DAY: parseInt(process.env.MAX_PICK_POSTS_PER_DAY) || 1,
  MAX_QUOTE_RTS_PER_DAY: parseInt(process.env.MAX_QUOTE_RTS_PER_DAY) || 2,
  MAX_POST_LENGTH: 280,
  MAX_WORDS: 20,
};

// DailyStockPick API
const DSP_API_URL = process.env.DSP_API_URL || 'https://dailystockpick.ai';

// Market Session Configuration
const MARKET_SESSION = {
  DSP_RECENT_DAYS: parseInt(process.env.DSP_RECENT_DAYS) || 7,
  MAX_SEARCHES: parseInt(process.env.MARKET_MAX_SEARCHES) || 8,
  MAX_SEARCH_RESULTS: parseInt(process.env.MARKET_MAX_SEARCH_RESULTS) || 15,
  MAX_LIKES: parseInt(process.env.MARKET_MAX_LIKES) || 5,
  MIN_SCORE_TO_LIKE: 7,
  MIN_SCORE_TO_DIGEST: 7,
  MIN_SCORE_TO_QUOTE_RT: parseInt(process.env.MARKET_MIN_SCORE_TO_QUOTE_RT) || 8,
  MAX_QUOTE_RTS: parseInt(process.env.MARKET_MAX_QUOTE_RTS) || 3,
  MAX_POST_LENGTH: 200,
};

// Hot Take Session Configuration
const HOT_TAKE_CONFIG = {
  ENABLED: true,
  MAX_ENGAGEMENTS: 3,
  INSPIRATION_ROTATION: ['web_search', 'x_trending', 'owner_archive'],
  OWNER_USERNAME: 'your_handle',
  MIN_FOLLOWERS_FOR_QUOTE_RT: 5000,
  IMAGE_GEN_ENABLED: true,
  IMAGE_MODEL: 'gpt-image-1',
  IMAGE_SIZE: '1024x1024',
  IMAGE_STYLE: 'abstract, futuristic, dark, thought-provoking',
};

// Owner's interest profile path
const OWNER_INTERESTS_PATH = process.env.OWNER_INTERESTS_PATH
  || require('path').join(__dirname, '..', 'interests', 'owner-interests.md');

// Load runtime config from MongoDB, falling back to .env/defaults
async function loadRuntimeConfig(db) {
  try {
    const configDoc = await db.collection('tommy_config').findOne({ _id: 'tommy_config' });
    if (!configDoc) return null;
    // Merge hotTake section if present
    if (configDoc.hotTake) {
      Object.assign(HOT_TAKE_CONFIG, configDoc.hotTake);
    }
    return configDoc;
  } catch (err) {
    console.error('Failed to load runtime config:', err.message);
    return null;
  }
}

module.exports = {
  loadRuntimeConfig,
  X_API_BASE_URL,
  SESSION_LIMITS,
  RATE_LIMITS,
  MONGODB,
  X_CREDENTIALS,
  API_ENDPOINTS,
  TWEET_FIELDS,
  USER_FIELDS,
  AVOID_PATTERNS,
  PRICING,
  OWNER_PROFILE,
  MAX_LIKES_PER_AUTHOR,
  AI_CONFIG,
  POSTING_CONFIG,
  OWNER_INTERESTS_PATH,
  DSP_API_URL,
  MARKET_SESSION,
  HOT_TAKE_CONFIG,
};