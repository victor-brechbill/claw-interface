const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class XAPIClient {
  constructor() {
    this.oauth = OAuth({
      consumer: {
        key: config.X_CREDENTIALS.CONSUMER_KEY,
        secret: config.X_CREDENTIALS.CONSUMER_SECRET,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto
          .createHmac('sha1', key)
          .update(base_string)
          .digest('base64');
      },
    });

    this.token = {
      key: config.X_CREDENTIALS.ACCESS_TOKEN,
      secret: config.X_CREDENTIALS.ACCESS_TOKEN_SECRET,
    };

    this.userId = config.X_CREDENTIALS.USER_ID;
  }

  async delay(ms = config.RATE_LIMITS.API_DELAY_MS) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Encode query string with proper RFC 3986 encoding (use %20 for spaces, not +)
  // X API changed to strict OAuth signature validation requiring %20 encoding
  encodeQueryString(params) {
    return new URLSearchParams(params).toString().replace(/\+/g, '%20');
  }

  // Set database for usage tracking
  setDatabase(db) {
    this.db = db;
  }

  async makeRequest(url, options = {}) {
    const method = options.method || 'GET';
    const startTime = Date.now();

    // OAuth 1.0a requires query params in the signature base string.
    // Parse them out so oauth.authorize can include them properly.
    const urlObj = new URL(url);
    const requestData = { url: urlObj.origin + urlObj.pathname, method };
    if (urlObj.search) {
      requestData.data = Object.fromEntries(urlObj.searchParams.entries());
    }

    const authHeader = this.oauth.toHeader(
      this.oauth.authorize(requestData, this.token)
    );

    const response = await this._fetchWithRetries(url, {
      method,
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    // Track API usage
    const responseTimeMs = Date.now() - startTime;
    const endpoint = url.replace(config.X_API_BASE_URL, '').replace(/\/\d+/g, '/:id');
    if (this.db) {
      this.db.logApiUsage(this.currentSessionId || 'unknown', endpoint, method, response.status, responseTimeMs).catch(() => {});
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`X API Error ${response.status}: ${error}`);
    }

    return response.json();
  }

  async _fetchWithRetries(url, options) {
    let lastError;
    const maxRetries = config.RATE_LIMITS.MAX_RETRIES;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Retry on rate limit (429) or server errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          if (attempt >= maxRetries - 1) {
            return response; // Return the error response on final attempt
          }
          const retryAfter = response.headers.get('retry-after');
          // Exponential backoff: 2s, 4s, 8s (doubles each attempt)
          const backoff = retryAfter
            ? parseInt(retryAfter) * 1000
            : 2000 * Math.pow(2, attempt);
          console.log(`⚠️ HTTP ${response.status} — retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
          await this.delay(backoff);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          // Exponential backoff for network errors too
          const backoff = 2000 * Math.pow(2, attempt);
          console.log(`⚠️ Network error — retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries}):`, error.message);
          await this.delay(backoff);
        }
      }
    }

    throw lastError;
  }

  // Get Tommy's user ID and cache it
  async getMe() {
    if (this.userId) {
      return { data: { id: this.userId } };
    }

    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.USER_ME}`;
    const result = await this.makeRequest(url);
    this.userId = result.data.id;
    console.log(`Cached Tommy's user ID: ${this.userId}`);
    return result;
  }

  // Get home timeline
  async getHomeTimeline(maxResults = 100) {
    if (!this.userId) {
      await this.getMe();
    }

    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.USER_TIMELINE(this.userId)}`;
    const params = {
      'max_results': Math.min(maxResults, 100).toString(),
      'tweet.fields': config.TWEET_FIELDS,
      // Skip user.fields expansion to save $0.01/user — only look up users when needed (follows)
      'expansions': 'author_id'
    };

    const fullUrl = `${url}?${this.encodeQueryString(params)}`;
    await this.delay();
    return this.makeRequest(fullUrl);
  }

  // Search recent tweets
  async searchRecent(query, maxResults = 10, options = {}) {
    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.SEARCH_RECENT}`;
    const paramObj = {
      'query': query,
      'max_results': Math.min(maxResults, 100).toString(),
      'tweet.fields': config.TWEET_FIELDS,
      'expansions': 'author_id',
      'user.fields': 'verified_followers_count,is_identity_verified,public_metrics,username',
      // Default to relevancy sort — returns highest quality results first
      'sort_order': options.sortOrder || 'relevancy',
    };

    const fullUrl = `${url}?${this.encodeQueryString(paramObj)}`;
    await this.delay();
    const result = await this.makeRequest(fullUrl);

    // Attach user data to tweets for easy access
    if (result?.data && result?.includes?.users) {
      const userMap = {};
      for (const u of result.includes.users) {
        userMap[u.id] = u;
      }
      for (const tweet of result.data) {
        tweet._author = userMap[tweet.author_id] || null;
      }
    }

    return result;
  }

  // Like a tweet
  async likePost(tweetId) {
    if (!this.userId) {
      await this.getMe();
    }

    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.USER_LIKES(this.userId)}`;
    await this.delay();
    return this.makeRequest(url, {
      method: 'POST',
      body: { tweet_id: tweetId }
    });
  }

  // Follow a user
  async followUser(targetUserId) {
    if (!this.userId) {
      await this.getMe();
    }

    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.USER_FOLLOWING(this.userId)}`;
    await this.delay();
    return this.makeRequest(url, {
      method: 'POST',
      body: { target_user_id: targetUserId }
    });
  }

  // Get a user's recent liked tweets
  async getUserLikes(userId, maxResults = 20) {
    const url = `${config.X_API_BASE_URL}/users/${userId}/liked_tweets`;
    const params = {
      'max_results': Math.min(maxResults, 100).toString(),
      'tweet.fields': config.TWEET_FIELDS,
      'expansions': 'author_id',
      'user.fields': config.USER_FIELDS,
    };

    const fullUrl = `${url}?${this.encodeQueryString(params)}`;
    await this.delay();
    return this.makeRequest(fullUrl);
  }

  // Get a user's recent tweets
  async getUserTweets(userId, maxResults = 10) {
    const url = `${config.X_API_BASE_URL}/users/${userId}/tweets`;
    const params = {
      'max_results': Math.min(maxResults, 100).toString(),
      'tweet.fields': config.TWEET_FIELDS,
      'expansions': 'author_id',
      'user.fields': config.USER_FIELDS,
    };

    const fullUrl = `${url}?${this.encodeQueryString(params)}`;
    await this.delay();
    return this.makeRequest(fullUrl);
  }

  // Create a quote repost (quote RT)
  async createQuoteRepost(tweetText, quotedTweetId) {
    const url = `${config.X_API_BASE_URL}/tweets`;
    await this.delay();
    return this.makeRequest(url, {
      method: 'POST',
      body: {
        text: tweetText,
        quote_tweet_id: quotedTweetId,
      }
    });
  }

  // Upload media via X API v1.1 (required for image tweets)
  async uploadMedia(imagePath) {
    const mediaData = fs.readFileSync(imagePath);
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const url = 'https://upload.twitter.com/1.1/media/upload.json';

    // Use chunked upload (INIT/APPEND/FINALIZE) — simple upload has OAuth signing issues
    // Step 1: INIT
    const initParams = {
      command: 'INIT',
      total_bytes: String(mediaData.length),
      media_type: mimeType,
      media_category: 'tweet_image',
    };
    const initAuth = this.oauth.toHeader(
      this.oauth.authorize({ url, method: 'POST', data: initParams }, this.token)
    );
    await this.delay();
    const initResp = await this._fetchWithRetries(url, {
      method: 'POST',
      headers: { ...initAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: this.encodeQueryString(initParams),
    });
    if (!initResp.ok) {
      const error = await initResp.text();
      throw new Error(`Media upload INIT failed ${initResp.status}: ${error}`);
    }
    const initResult = await initResp.json();
    const mediaId = initResult.media_id_string;

    // Step 2: APPEND (send media as multipart FormData with query params)
    // OAuth signs the URL (including query params) but NOT the multipart body
    const appendQuery = { command: 'APPEND', media_id: mediaId, segment_index: '0' };
    const appendUrl = url + '?' + this.encodeQueryString(appendQuery);
    const appendAuth = this.oauth.toHeader(
      this.oauth.authorize({ url: appendUrl, method: 'POST' }, this.token)
    );
    const form = new FormData();
    form.append('media', new Blob([mediaData], { type: mimeType }), 'media.png');
    await this.delay();
    const appendResp = await this._fetchWithRetries(appendUrl, {
      method: 'POST',
      headers: { ...appendAuth },
      body: form,
    });
    if (!appendResp.ok && appendResp.status !== 204) {
      const error = await appendResp.text();
      throw new Error(`Media upload APPEND failed ${appendResp.status}: ${error}`);
    }

    // Step 3: FINALIZE
    const finalizeParams = { command: 'FINALIZE', media_id: mediaId };
    const finalizeAuth = this.oauth.toHeader(
      this.oauth.authorize({ url, method: 'POST', data: finalizeParams }, this.token)
    );
    await this.delay();
    const finalizeResp = await this._fetchWithRetries(url, {
      method: 'POST',
      headers: { ...finalizeAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: this.encodeQueryString(finalizeParams),
    });
    if (!finalizeResp.ok) {
      const error = await finalizeResp.text();
      throw new Error(`Media upload FINALIZE failed ${finalizeResp.status}: ${error}`);
    }

    console.log(`📸 Media uploaded: ${mediaId}`);
    return mediaId;
  }

  // Create a tweet with media attachments
  async createTweetWithMedia(text, mediaIds) {
    const url = `${config.X_API_BASE_URL}/tweets`;
    await this.delay();
    return this.makeRequest(url, {
      method: 'POST',
      body: {
        text: text,
        media: {
          media_ids: Array.isArray(mediaIds) ? mediaIds : [mediaIds],
        },
      },
    });
  }

  // Post a text-only tweet, optionally as a reply
  async post(text, options = {}) {
    const url = `${config.X_API_BASE_URL}/tweets`;
    const body = { text };
    if (options.replyTo) {
      body.reply = { in_reply_to_tweet_id: options.replyTo };
    }
    await this.delay();
    return this.makeRequest(url, { method: 'POST', body });
  }

  // Get personalized trending topics
  async getPersonalizedTrends() {
    const url = `${config.X_API_BASE_URL}/users/personalized_trends`;
    await this.delay();
    return this.makeRequest(url);
  }

  // Get trending topics by WOEID (location)
  async getTrendsByWoeid(woeid = 23424977) {
    const url = `${config.X_API_BASE_URL}/trends/by/woeid/${woeid}`;
    await this.delay();
    return this.makeRequest(url);
  }

  // Get engagement metrics for a single tweet
  async getTweetMetrics(tweetId) {
    const url = `${config.X_API_BASE_URL}/tweets/${tweetId}`;
    const params = {
      'tweet.fields': 'public_metrics',
    };
    const fullUrl = `${url}?${this.encodeQueryString(params)}`;
    await this.delay();
    const result = await this.makeRequest(fullUrl);
    const m = result?.data?.public_metrics;
    if (!m) return null;
    return {
      like_count: m.like_count || 0,
      retweet_count: m.retweet_count || 0,
      reply_count: m.reply_count || 0,
      impression_count: m.impression_count || 0,
      quote_count: m.quote_count || 0,
      bookmark_count: m.bookmark_count || 0,
    };
  }

  // Get follower count for a username
  async getFollowerCount(username) {
    const result = await this.getUserByUsername(username);
    return result?.data?.public_metrics?.followers_count || null;
  }

  // Get user by username
  async getUserByUsername(username) {
    const url = `${config.X_API_BASE_URL}${config.API_ENDPOINTS.USER_BY_USERNAME(username)}`;
    const params = {
      'user.fields': config.USER_FIELDS
    };

    const fullUrl = `${url}?${this.encodeQueryString(params)}`;
    await this.delay();
    return this.makeRequest(fullUrl);
  }
}

module.exports = XAPIClient;