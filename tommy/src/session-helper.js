/**
 * Shared session initialization for Tommy scripts.
 * Reduces boilerplate across collect.js, collect-market.js, and engage.js.
 */

const XAPIClient = require('./x-client');
const TommyDatabase = require('./db');
const config = require('./config');

/**
 * Initialize a Tommy session with database, X API client, and runtime config.
 * 
 * @param {Object} options
 * @param {string} [options.sessionType] - Session type to start (e.g., 'explore', 'market'). 
 *   If omitted, no session is started (caller manages session ID).
 * @returns {Object} { xClient, database, session, runtimeConfig }
 */
async function initSession({ sessionType } = {}) {
  const xClient = new XAPIClient();
  const database = new TommyDatabase();

  await database.connect();
  xClient.setDatabase(database);

  let session = null;
  if (sessionType) {
    session = await database.startSession(sessionType);
    xClient.currentSessionId = session.sessionId;
  }

  const runtimeConfig = await config.loadRuntimeConfig(database.db);

  return { xClient, database, session, runtimeConfig };
}

module.exports = { initSession };
