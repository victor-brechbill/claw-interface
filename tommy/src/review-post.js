#!/usr/bin/env node

/**
 * review-post.js — Content review via the content-editor agent
 * 
 * Uses `openclaw agent` CLI to run a quick content-editor turn.
 * Returns structured JSON: { approved, issues, suggestions, revisedText }
 * 
 * Usage: node src/review-post.js --text "draft text" --author "TommyPickles" --type "quote_rt" [--max-words 20]
 * 
 * Exit codes:
 *   0 = approved (stdout = JSON)
 *   1 = rejected (stdout = JSON with feedback)
 *   2 = error (stderr)
 */

const { execSync } = require('child_process');

async function main() {
  const args = process.argv.slice(2);
  
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  const text = getArg('--text');
  const author = getArg('--author') || 'TommyPickles';
  const type = getArg('--type') || 'quote_rt';
  const maxWords = parseInt(getArg('--max-words') || '20');
  const context = getArg('--context') || '';

  if (!text) {
    console.error('❌ --text is required');
    process.exit(2);
  }

  const wordCount = text.trim().split(/\s+/).length;
  const charCount = text.length;

  const reviewPrompt = `Review this social media post draft. Respond with ONLY valid JSON, no other text.

DRAFT POST:
"${text.replace(/"/g, '\\"')}"

METADATA:
- Author: @${author}
- Platform: X/Twitter  
- Post type: ${type}
- Word count: ${wordCount} (max: ${maxWords})
- Character count: ${charCount} (max: 280)
${context ? `- Context: ${context}` : ''}

EDITORIAL CHECKLIST:
1. HARD REJECT if: violence/threats, doxxing, hate speech, explicit financial advice ("buy this"), spam, impersonation
2. SOFT REJECT if: exceeds ${maxWords} words, off-brand, too generic, contains hashtags, contains "not financial advice", mentions URLs, too many emojis
3. APPROVE if: on-brand, adds value, within limits, safe to post

For ${author}'s voice: casual, punchy, authentic, slightly excited about market/tech. Lowercase OK. 1-2 emojis max.

CRITICAL: If rejecting, you MUST provide a "revisedText" — a revised version that fixes ALL issues while keeping the same core message/insight. Never return revisedText as null when rejecting. The revised text must be within ${maxWords} words and 280 characters.

Respond with ONLY this JSON (no markdown, no backticks):
{"approved": true/false, "issues": ["..."], "suggestions": ["..."], "revisedText": "fixed version if rejected, null only if approved"}`;

  try {
    // Use openclaw CLI to run the content-editor agent
    const fs = require('fs');
    const tmpFile = '/tmp/content-review-prompt.txt';
    fs.writeFileSync(tmpFile, reviewPrompt);

    const cmd = `openclaw agent --agent content-editor --message "$(cat ${tmpFile})" --json --timeout 60 2>/dev/null`;
    const stdout = execSync(cmd, { timeout: 90000, encoding: 'utf8', maxBuffer: 1024 * 1024 });

    // Parse the JSON response from openclaw agent
    let agentResult;
    try {
      agentResult = JSON.parse(stdout);
    } catch {
      // Try to find JSON in output
      const jsonMatch = stdout.match(/\{[\s\S]*"approved"[\s\S]*\}/);
      if (jsonMatch) {
        agentResult = { reply: jsonMatch[0] };
      } else {
        throw new Error(`Could not parse agent output: ${stdout.slice(0, 200)}`);
      }
    }

    // Extract the review from the agent's reply
    const reply = agentResult.reply || agentResult.text || agentResult.content || JSON.stringify(agentResult);
    
    // Try to parse JSON from the reply
    let review;
    const jsonMatch = reply.match(/\{[\s\S]*"approved"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        review = JSON.parse(jsonMatch[0]);
      } catch {
        review = { approved: true, issues: ['Could not parse editor response'], suggestions: [], revisedText: null };
      }
    } else {
      review = { approved: true, issues: ['No structured response from editor'], suggestions: [], revisedText: null };
    }

    // Output the review
    console.log(JSON.stringify(review));
    process.exit(review.approved ? 0 : 1);

  } catch (err) {
    console.error(`❌ Content review failed: ${err.message}`);
    // On error, output a cautious rejection
    console.log(JSON.stringify({
      approved: false,
      issues: [`Review system error: ${err.message}`],
      suggestions: ['Retry or skip this post'],
      revisedText: null,
    }));
    process.exit(2);
  }
}

main();
