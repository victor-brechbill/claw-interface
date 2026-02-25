const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

/**
 * InterestMatcher — now a thin wrapper.
 * AI scoring (ai-scorer.js) handles the actual content evaluation.
 * This module retains: interest loading, signal extraction, avoid-pattern filtering.
 */
class InterestMatcher {
  constructor() {
    this.interests = null;
    this.interestsPath = config.VICTOR_INTERESTS_PATH;
    this.dynamicInterests = { topics: [], authors: [], tickers: [] };
  }

  async loadInterests(filePath = this.interestsPath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      this.interests = this.parseInterests(content);
      console.log(`Loaded interests file (${this.interests.tickers.length} tickers)`);
      return this.interests;
    } catch (error) {
      console.error('Failed to load interests file:', error);
      throw error;
    }
  }

  parseInterests(content) {
    const tickers = [];
    const watchlistMatch = content.match(/<!-- WATCHLIST_START -->(.*?)<!-- WATCHLIST_END -->/s);
    if (watchlistMatch) {
      const tickerMatches = watchlistMatch[1].match(/([A-Z]{1,5})\s*\(/g);
      if (tickerMatches) {
        tickerMatches.forEach(match => tickers.push(match.replace(/\s*\(/, '')));
      }
    }
    ['RKLB', 'TSLA', 'MSFT', 'GOOGL', 'AAPL'].forEach(t => {
      if (!tickers.includes(t)) tickers.push(t);
    });
    return { tickers };
  }

  // Extract dynamic interest signals from Victor's X activity
  extractSignals(tweets) {
    const topics = new Set();
    const authors = new Set();
    const tickers = new Set();

    for (const tweet of tweets) {
      if (!tweet.text) continue;
      const words = tweet.text.split(/\s+/);
      words.filter(w => /^\$[A-Z]{1,5}$/.test(w)).forEach(t => tickers.add(t.slice(1)));
      if (tweet.author_id) authors.add(tweet.author_id);
      words.filter(w => w.startsWith('#') && w.length > 2)
        .forEach(h => topics.add(h.slice(1).toLowerCase()));
      words.filter(w => w.startsWith('@') && w.length > 2)
        .forEach(m => authors.add(m.slice(1).toLowerCase()));
    }

    return { topics: [...topics], authors: [...authors], tickers: [...tickers] };
  }

  setDynamicInterests(signals) {
    this.dynamicInterests = signals;
    console.log(`📊 Dynamic interests: ${signals.topics.length} topics, ${signals.authors.length} authors, ${signals.tickers.length} tickers`);
  }

  /**
   * Extract Victor's liked post IDs for the exclusion set.
   */
  extractExclusionSet(likes, tweets) {
    const exclusionSet = new Set();
    for (const item of [...(likes || []), ...(tweets || [])]) {
      if (item.id) exclusionSet.add(item.id);
    }
    return exclusionSet;
  }

  // Check if post should be avoided (spam, engagement bait)
  shouldAvoidPost(post) {
    const text = post.text || '';
    const lower = text.toLowerCase();

    for (const pattern of config.AVOID_PATTERNS) {
      if (pattern.test(text)) return { avoid: true, reason: `matches avoid pattern: ${pattern.source}` };
    }

    const engagementBait = [
      'like if you agree', 'share if you', 'comment below', 'tag someone',
      'follow for more', 'giveaway', 'not financial advice', 'moon soon',
      'lambo', 'hodl',
    ];
    for (const bait of engagementBait) {
      if (lower.includes(bait)) return { avoid: true, reason: `engagement bait: ${bait}` };
    }

    if (text.length < 20) return { avoid: true, reason: 'too short' };

    const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
    if (emojiCount > 5) return { avoid: true, reason: 'too many emojis' };

    return { avoid: false };
  }
}

module.exports = InterestMatcher;
