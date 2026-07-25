# CC Brain: Slack Bot Implementation Guide

**Last Updated:** July 25, 2026  
**Status:** Complete & Tested  
**Time to Complete:** ~4-5 hours

---

## Overview

This document walks through building a Slack bot that queries a GitHub-hosted Obsidian vault and synthesizes answers using Claude API.

**Architecture:**
- Obsidian Vault (local knowledge base)
- GitHub (vault storage + API access)
- Slack Bot (Node.js + Socket Mode)
- Claude API (answer synthesis)

---

## Prerequisites

Before starting, you need:

1. **Obsidian** (desktop app) — https://obsidian.md
2. **Node.js** (v18+) — https://nodejs.org
3. **GitHub account** — https://github.com
4. **Claude API key** — https://console.anthropic.com
5. **Slack workspace** (admin access)

---

## Phase 1: Obsidian Vault Setup

### 1.1 Create Vault Directory Structure

```bash
mkdir -p vault/{01-Brand,02-Operations,03-Drops,04-Content,05-Retail}
cd vault
```

### 1.2 Organize Content into Notes

Break down your brand/operational knowledge into individual markdown files:

**File naming convention:** `[number]-[topic].md`

Examples:
- `01-Brand/01-North-Star.md`
- `02-Operations/01-The-Business-Model.md`
- `03-Drops/01-Drop-System-Overview.md`

**Each file should have:**
```yaml
---
tags: category, subcategory
---

# Title

Content here...
```

### 1.3 Test Locally in Obsidian

1. Open Obsidian desktop app
2. File → Open vault folder
3. Navigate to your vault directory
4. Verify all files are readable and links work

---

## Phase 2: GitHub Setup

### 2.1 Initialize Git Locally

```bash
cd vault
git init
git add .
git commit -m "Initial commit: Knowledge vault"
git branch -M main
```

### 2.2 Create GitHub Repository

1. Go to https://github.com/new
2. **Repository name:** `cc-knowledge-vault` (or your name)
3. **Visibility:** Public
4. **Don't** initialize with README
5. Click "Create repository"

### 2.3 Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/cc-knowledge-vault.git
git push -u origin main
```

### 2.4 Generate GitHub Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. **Name:** `slack-bot`
4. **Scopes:** Check `repo` (full control)
5. Copy token and store safely (you'll need it in `.env`)

---

## Phase 3: Slack App Setup

### 3.1 Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. **App name:** `CC Brain` (or your name)
4. **Workspace:** Select your workspace
5. Click "Create App"

### 3.2 Enable Socket Mode

1. Left sidebar → **Socket Mode**
2. Toggle ON "Enable Socket Mode"
3. A popup shows your **App-Level Token** (starts with `xapp-`)
4. Copy this token (you'll need it in `.env`)

### 3.3 Set OAuth Scopes

1. Left sidebar → **OAuth & Permissions**
2. Under **Bot Token Scopes**, add these scopes:
   - `app_mentions:read`
   - `chat:write`
   - `reactions:read`
   - `reactions:write`
   - `im:read`
   - `im:history`
3. Scroll up to **OAuth Tokens for Your Workspace**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Store this in `.env`

### 3.4 Subscribe to Bot Events

1. Left sidebar → **Event Subscriptions**
2. Toggle ON "Enable Events"
3. Under **Subscribe to bot events**, add:
   - `app_mention`
   - `message.im`
4. Click "Save Changes"

### 3.5 Install Bot to Workspace

1. Left sidebar → **Install App**
2. Click "Install to Workspace"
3. Authorize the app

---

## Phase 4: Node.js Bot Setup

### 4.1 Initialize Node.js Project

```bash
mkdir bot
cd bot
npm init -y
```

### 4.2 Install Dependencies

```bash
npm install @slack/bolt axios dotenv express
```

### 4.3 Create `.env` File

Create `bot/.env` with your credentials:

```
# Slack
SLACK_BOT_TOKEN=xoxb-YOUR-BOT-TOKEN
SLACK_APP_TOKEN=xapp-YOUR-APP-TOKEN

# GitHub
GITHUB_TOKEN=github_pat_YOUR-TOKEN
GITHUB_REPO=username/cc-knowledge-vault

# Claude API
CLAUDE_API_KEY=sk-ant-api03-YOUR-KEY

# Server
PORT=3000
```

**⚠️ NEVER commit `.env` to git. Add to `.gitignore`:**

```
.env
.env.local
node_modules/
```

### 4.4 Create Bot Code

Create `bot/index.js` with the complete bot logic:

```javascript
require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');

// Initialize with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

/**
 * Search GitHub vault for relevant files
 */
async function searchVault(query) {
  try {
    console.log('🔍 Searching vault for:', query);

    const treeResponse = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    const mdFiles = treeResponse.data.tree.filter(
      f => f.path.endsWith('.md') && !f.path.includes('.gitignore')
    );
    console.log('📊 Found', mdFiles.length, 'markdown files');

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

    const prompt = `You are a helpful assistant for this organization's brand and operations.

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

    const textBlock = response.data.content.find(block => block.type === 'text');

    if (!textBlock || !textBlock.text) {
      console.error('❌ No text block in Claude response');
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
        text: "I couldn't find relevant information in the vault for that query. Try asking about: brand, operations, products, or strategy.",
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
 * Start the app
 */
(async () => {
  await app.start();
  console.log('⚡️ Socket Mode bot is running!');
  console.log('🔗 Connected to Slack via WebSocket');
})();
```

### 4.5 Start the Bot

```bash
npm start
```

You should see:
```
⚡️ Socket Mode bot is running!
🔗 Connected to Slack via WebSocket
```

---

## Phase 5: Test the Bot

### In Slack:

**Test 1: Mention in a channel**
```
@CC Brain what is the north star?
```

**Test 2: Try other queries**
```
@CC Brain how do drops work?
@CC Brain tell me about the film system
@CC Brain who is our customer?
```

The bot should:
1. Search the vault for matching notes
2. Call Claude with the context
3. Reply with an answer that cites sources

---

## Troubleshooting

### Bot not responding to mentions

**Check:**
1. Is the bot connected? (Look for "Connected to Slack via WebSocket" in terminal)
2. Is the bot in the channel? (Add it if not)
3. Are you using the right mention format? (`@CC Brain query`)

**Fix:**
- Restart the bot: `npm start`
- Check terminal logs for errors

### GitHub search returns 0 results

**Reason:** The local file search might not find files if:
- Files haven't been pushed to GitHub
- Search terms don't match content

**Fix:**
- Push changes: `git push origin main`
- Try simpler search terms
- Check the terminal log to see which files were matched

### Claude returns empty response

**Reason:** The Claude API response might have an unexpected format.

**Fix:**
- Check your Claude API key in `.env`
- Verify you have sufficient Claude API credits
- Look at the terminal logs for the full response structure

### "missing required field: name" error

This was an issue with emoji reactions. The current code has been fixed to skip reactions if they fail.

---

## Common Commands

### Update the vault

```bash
cd vault
# Make changes to files
git add .
git commit -m "Update: [what changed]"
git push origin main
```

### Check bot status

Look at the terminal where `npm start` is running. You should see logs for each mention.

### Stop the bot

Press `Ctrl+C` in the terminal.

### Restart the bot

```bash
npm start
```

---

## File Structure

After completing all phases, you should have:

```
AI-Brain-Tool/
├── vault/
│   ├── 01-Brand/
│   │   ├── 01-North-Star.md
│   │   ├── 02-Origin-Story.md
│   │   └── 03-Our-Customer.md
│   ├── 02-Operations/
│   ├── 03-Drops/
│   ├── 04-Content/
│   ├── 05-Retail/
│   ├── .git/
│   ├── .gitignore
│   └── README.md
├── bot/
│   ├── index.js
│   ├── package.json
│   ├── .env (NOT in git)
│   └── .gitignore
└── docs/
    └── IMPLEMENTATION.md (this file)
```

---

## Environment Variables Reference

| Variable | Example | Where to get |
|----------|---------|--------------|
| SLACK_BOT_TOKEN | `xoxb-11671...` | Slack app → OAuth & Permissions |
| SLACK_APP_TOKEN | `xapp-1-A0BK...` | Slack app → Socket Mode |
| GITHUB_TOKEN | `github_pat_11AI...` | GitHub → Settings → Developer settings → Tokens |
| GITHUB_REPO | `username/cc-knowledge-vault` | Your GitHub repo name |
| CLAUDE_API_KEY | `sk-ant-api03-...` | https://console.anthropic.com/account/keys |
| PORT | `3000` | Default, change if 3000 is in use |

---

## Next Steps & Improvements

### Phase 2 (Future)
- Add confidence scoring to answers
- Implement escalation for uncertain queries
- Add audit logging

### Phase 3 (Future)
- Deploy bot to production (Railway, Vercel, etc.)
- Add web UI for querying vault
- Integrate with other tools (Slack commands, workflows)

---

## Support & Debugging

**If something breaks:**

1. Check the terminal logs (look for 🔴 error messages)
2. Verify all `.env` credentials are correct
3. Make sure Node.js dependencies are installed: `npm install`
4. Restart the bot: `npm start`

**Common issues are documented in the Troubleshooting section above.**

---

**Last tested:** July 25, 2026  
**Tested with:** Node.js v18+, Slack Bolt 3.17.0, Claude API
