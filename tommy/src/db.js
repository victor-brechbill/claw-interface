const { MongoClient } = require('mongodb');
const config = require('./config');

class TommyDatabase {
  constructor() {
    this.client = null;
    this.db = null;
  }

  // Connect to MongoDB
  async connect() {
    try {
      this.client = new MongoClient(config.MONGODB.URI);
      await this.client.connect();
      this.db = this.client.db(config.MONGODB.DATABASE);
      console.log(`Connected to MongoDB: ${config.MONGODB.DATABASE}`);
    } catch (error) {
      console.error('MongoDB connection failed:', error);
      throw error;
    }
  }

  // Disconnect from MongoDB
  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('Disconnected from MongoDB');
    }
  }

  // Save an interesting find
  async saveFinding(post, author, matchData, sessionId, actions = {}) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.FINDS);
    
    const finding = {
      postId: post.id,
      authorHandle: author.username,
      authorName: author.name,
      postText: post.text,
      postUrl: `https://x.com/${author.username}/status/${post.id}`,
      createdAt: post.created_at,
      matchedInterests: matchData.matchedTopics || [],
      matchedTickers: matchData.matchedTickers || [],
      score: matchData.score || 0,
      reason: matchData.reason,
      liked: actions.liked || false,
      followed: actions.followed || false,
      quotedRt: actions.quotedRt || false,
      sessionId: sessionId,
      sessionType: actions.sessionType || 'explore',
      foundAt: new Date(),
      // Additional metadata
      authorVerified: author.verified || false,
      authorFollowerCount: author.public_metrics?.followers_count || 0,
      postMetrics: {
        likeCount: post.public_metrics?.like_count || 0,
        retweetCount: post.public_metrics?.retweet_count || 0,
        replyCount: post.public_metrics?.reply_count || 0
      }
    };

    const result = await collection.insertOne(finding);
    console.log(`Saved finding: ${finding.postId} (score: ${finding.score})`);
    return result;
  }

  // Start a new session
  async startSession(sessionType = 'automated') {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.SESSIONS);
    
    const session = {
      sessionId: this._generateSessionId(),
      sessionType: sessionType,
      startedAt: new Date(),
      status: 'running',
      stats: {
        postsScanned: 0,
        postsLiked: 0,
        usersFollowed: 0,
        findingsSaved: 0,
        searchesPerformed: 0
      },
      phase: 'starting'
    };

    await collection.insertOne(session);
    console.log(`Started session: ${session.sessionId}`);
    return session;
  }

  // Update session stats
  async updateSession(sessionId, updates) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.SESSIONS);
    
    const updateDoc = {
      ...updates,
      lastUpdated: new Date()
    };

    const result = await collection.updateOne(
      { sessionId: sessionId },
      { $set: updateDoc }
    );

    return result;
  }

  // Complete a session
  async completeSession(sessionId, finalStats = {}, error = null) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.SESSIONS);
    
    const updates = {
      status: error ? 'failed' : 'completed',
      completedAt: new Date(),
      ...finalStats
    };

    if (error) {
      updates.error = {
        message: error.message,
        stack: error.stack
      };
    }

    const result = await collection.updateOne(
      { sessionId: sessionId },
      { $set: updates }
    );

    const status = error ? 'Failed' : 'Completed';
    console.log(`${status} session: ${sessionId}`);
    return result;
  }

  // Get recent session stats
  async getRecentSessions(limit = 10) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.SESSIONS);
    
    const sessions = await collection
      .find({})
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();

    return sessions;
  }

  // Get recent findings
  async getRecentFindings(limit = 20) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.FINDS);
    
    const findings = await collection
      .find({})
      .sort({ foundAt: -1 })
      .limit(limit)
      .toArray();

    return findings;
  }

  // Check if we've already processed a post (to avoid duplicates)
  async hasProcessedPost(postId) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.FINDS);
    
    const existing = await collection.findOne({ postId: postId });
    return !!existing;
  }

  // Get stats for a specific session
  async getSessionStats(sessionId) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.SESSIONS);
    
    const session = await collection.findOne({ sessionId: sessionId });
    return session;
  }

  // Generate a unique session ID
  _generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `tommy_${timestamp}_${random}`;
  }

  // Track API usage per session
  async logApiUsage(sessionId, endpoint, method, statusCode, responseTimeMs) {
    const collection = this.db.collection('tommy_api_usage');
    
    await collection.insertOne({
      sessionId,
      endpoint,
      method,
      statusCode,
      responseTimeMs,
      timestamp: new Date(),
    });
  }

  // Get API usage summary for a date range
  async getApiUsageSummary(daysBack = 7) {
    const collection = this.db.collection('tommy_api_usage');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const summary = await collection.aggregate([
      { $match: { timestamp: { $gte: cutoff } } },
      { $group: {
        _id: { endpoint: '$endpoint', method: '$method' },
        count: { $sum: 1 },
        avgResponseMs: { $avg: '$responseTimeMs' },
        errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
      }},
      { $sort: { count: -1 } }
    ]).toArray();

    const total = await collection.countDocuments({ timestamp: { $gte: cutoff } });
    return { total, breakdown: summary };
  }

  // Get daily API call counts for cost tracking
  async getDailyApiCounts(daysBack = 30) {
    const collection = this.db.collection('tommy_api_usage');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    return collection.aggregate([
      { $match: { timestamp: { $gte: cutoff } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        calls: { $sum: 1 },
        reads: { $sum: { $cond: [{ $eq: ['$method', 'GET'] }, 1, 0] } },
        writes: { $sum: { $cond: [{ $eq: ['$method', 'POST'] }, 1, 0] } },
      }},
      { $sort: { _id: -1 } }
    ]).toArray();
  }

  // Count posts of a given type posted today
  async countPostsToday(type, todayStr) {
    const collection = this.db.collection('tommy_posts');
    const startOfDay = new Date(todayStr + 'T00:00:00.000Z');
    const endOfDay = new Date(todayStr + 'T23:59:59.999Z');
    return collection.countDocuments({
      type,
      postedAt: { $gte: startOfDay, $lte: endOfDay },
    });
  }

  // Check if exact text was already posted (duplicate prevention)
  async hasPostedExactText(text) {
    const collection = this.db.collection('tommy_posts');
    const count = await collection.countDocuments({ text });
    return count > 0;
  }

  // Check if a post was already quoted/replied to recently (7-day window)
  async hasQuotedRecently(quotedPostId, days = 7) {
    const collection = this.db.collection('tommy_posts');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const count = await collection.countDocuments({
      quotedPostId,
      postedAt: { $gte: cutoff },
    });
    return count > 0;
  }

  // Save a post Tommy made
  async savePost(postData) {
    const collection = this.db.collection('tommy_posts');
    
    const post = {
      postId: postData.postId,
      postUrl: postData.postUrl || `https://x.com/i/status/${postData.postId}`,
      text: postData.text,
      type: postData.type || 'quote_rt',
      quotedPostId: postData.quotedPostId || null,
      quotedPostUrl: postData.quotedPostUrl || null,
      quotedAuthor: postData.quotedAuthor || null,
      socialImagePath: postData.socialImagePath || null,
      ticker: postData.ticker || null,
      engagementSnapshot: postData.engagementSnapshot || null,
      postedAt: postData.postedAt || new Date(),
      createdAt: new Date(),
    };

    const result = await collection.insertOne(post);
    console.log(`Saved post: ${post.postId} (type: ${post.type})`);
    return result;
  }

  // Clean up old findings (optional maintenance)
  async cleanupOldFindings(daysToKeep = 90) {
    const collection = this.db.collection(config.MONGODB.COLLECTIONS.FINDS);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await collection.deleteMany({
      foundAt: { $lt: cutoffDate }
    });

    console.log(`Cleaned up ${result.deletedCount} old findings`);
    return result;
  }
}

module.exports = TommyDatabase;