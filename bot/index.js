require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');

console.log('🚀 Starting bot with Socket Mode...');

// Initialize Slack app with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// GitHub config
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

/**
 * Search GitHub vault for relevant files
 */
async function searchVault(query) {
  try {
    console.log('🔍 Searching vault for:', query);

    // Get list of all files in the vault
    const treeResponse = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    const mdFiles = treeResponse.data.tree.filter(f => f.path.endsWith('.md') && !f.path.includes('.gitignore'));
    console.log('📊 Found', mdFiles.length, 'markdown files');

    // Fetch each file and search locally
    const searchTerms = query.toLowerCase().split(/\s+/);
    const matches = [];

    for (const file of mdFiles) {
      const fileContent = await axios.get(
        `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${file.path}`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
          },
        }
      );

      const contentLower = fileContent.data.toLowerCase();
      const matchCount = searchTerms.filter(term => contentLower.includes(term)).length;

      if (matchCount > 0) {
        matches.push({
          path: file.path,
          content: fileContent.data,
          score: matchCount,
        });
      }
    }

    // Return top 3 matches sorted by score
    const topMatches = matches.sort((a, b) => b.score - a.score).slice(0, 3);
    console.log('📊 Matched', topMatches.length, 'files');

    return topMatches;
  } catch (error) {
    console.error('❌ Error searching vault:', error.message);
    return [];
  }
}

/**
 * Query Claude with context from vault
 */
async function queryClaudeWithContext(userQuery, vaultFiles) {
  try {
    const context = vaultFiles
      .map((f) => `\n--- File: ${f.path} ---\n${f.content}`)
      .join('\n');

    const prompt = `You are a helpful assistant for Clocks + Colours brand and operations.

Answer based on the provided vault content. If the answer is not in the vault, say "I don't have that information in the vault."

Always cite which note(s) you're drawing from.

Vault Content:
${context}

User Question: ${userQuery}`;

    console.log('🤖 Calling Claude...');
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    console.log('✅ Claude responded');
    console.log('Response:', JSON.stringify(response.data, null, 2).substring(0, 500));

    if (!response.data.content || response.data.content.length === 0) {
      console.error('❌ Invalid Claude response structure');
      return 'Error: Invalid response from Claude';
    }

    // Find the text block (skip thinking blocks)
    const textBlock = response.data.content.find(block => block.type === 'text');

    if (!textBlock || !textBlock.text) {
      console.error('❌ No text block in Claude response');
      console.log('Content blocks:', response.data.content.map(c => c.type));
      return 'Error: No text response from Claude';
    }

    const answer = textBlock.text;

    console.log('💬 Answer:', answer.substring(0, 200));
    return answer;
  } catch (error) {
    console.error('❌ Error calling Claude:', error.message);
    return `Sorry, I had an error processing that. Error: ${error.message}`;
  }
}

/**
 * Handle app mentions
 */
app.event('app_mention', async ({ event, client, logger }) => {
  try {
    console.log('🎯 app_mention handler triggered!');
    console.log('📨 Mention received:', event.text);
    const userQuery = event.text.replace(/<@[U\w]+>/g, '').trim();
    console.log('🔍 Query:', userQuery);

    const vaultFiles = await searchVault(userQuery);

    if (vaultFiles.length === 0) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "I couldn't find relevant information in the vault for that query. Try asking about: brand strategy, drops, content, retail, or operations.",
      });
      return;
    }

    const answer = await queryClaudeWithContext(userQuery, vaultFiles);

    if (!answer || answer.length === 0) {
      console.error('❌ Answer is empty!');
      return;
    }

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: answer,
    });
  } catch (error) {
    console.error('❌ Error in app_mention:', error);
    logger.error(error);
  }
});

/**
 * Handle direct messages
 */
app.message(async ({ event, client, logger }) => {
  try {
    console.log('💬 Message handler triggered');
    const userQuery = event.text;

    const vaultFiles = await searchVault(userQuery);

    if (vaultFiles.length === 0) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "I couldn't find relevant information in the vault for that query. Try asking about: brand strategy, drops, content, retail, or operations.",
      });
      return;
    }

    const answer = await queryClaudeWithContext(userQuery, vaultFiles);

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: answer,
    });
  } catch (error) {
    console.error('❌ Error in message:', error);
    logger.error(error);
  }
});

/**
 * Start the app
 */
(async () => {
  await app.start();
  console.log('⚡️ Socket Mode bot is running!');
  console.log('🔗 Connected to Slack via WebSocket');
})();
