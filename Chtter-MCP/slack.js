import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
//import dotenv from "dotenv";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
//dotenv.config({ path: path.join(__dirname, ".env") });
const { SLACK_TOKEN } = JSON.parse(fs.readFileSync(path.join(__dirname, "slack-token.json"), "utf8"));

async function slackApi(endpoint, params = {}) {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

// Search messages
async function searchMessages(query, count = 10) {
  const data = await slackApi("search.messages", { query, count });
  return data.messages.matches.map((m) => ({
    text: m.text,
    user: m.username,
    channel: m.channel?.name || "unknown",
    timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
    permalink: m.permalink,
    messageId: m.ts,
    channelId: m.channel?.id,
  }));
}

// Get channel/DM history
async function getConversationHistory(channelId, limit = 20) {
  const data = await slackApi("conversations.history", {
    channel: channelId,
    limit,
  });
  return data.messages.map((m) => ({
    text: m.text,
    user: m.user,
    timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
    messageId: m.ts,
  }));
}

// Look up a user by name
async function findUser(name) {
  const data = await slackApi("users.list");
  const users = data.members.filter(
    (u) =>
      u.real_name?.toLowerCase().includes(name.toLowerCase()) ||
      u.name?.toLowerCase().includes(name.toLowerCase())
  );
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    realName: u.real_name,
    email: u.profile?.email,
  }));
}

// List all DM conversations
async function listDMs() {
  const data = await slackApi("conversations.list", {
    types: "im",
    limit: 50,
  });

  // Look up user names for each DM
  const usersData = await slackApi("users.list");
  const userMap = {};
  usersData.members.forEach((u) => {
    userMap[u.id] = { name: u.name, realName: u.real_name };
  });

  return data.channels.map((c) => ({
    channelId: c.id,
    userId: c.user,
    name: userMap[c.user]?.realName || userMap[c.user]?.name || "Unknown",
    username: userMap[c.user]?.name,
  }));
}

async function sendMessage(channelId, text) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return { messageId: data.ts, channelId: data.channel };
}

// --- MCP Server Setup ---

const server = new Server(
  { name: "slack-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_slack",
      description: "Search Slack messages by keyword, user, or channel",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "string", description: "Keywords to search for" },
          from: { type: "string", description: "Username to filter by (e.g. john)" },
          channel: { type: "string", description: "Channel name to filter by (e.g. general)" },
          count: { type: "number", description: "Max results to return (default 10)" },
        },
      },
    },
    {
      name: "get_channel_history",
      description: "Get recent messages from a Slack channel or DM by channel ID",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "The Slack channel or DM ID" },
          limit: { type: "number", description: "Number of messages to fetch (default 20)" },
        },
        required: ["channelId"],
      },
    },
    {
      name: "find_user",
      description: "Look up a Slack user by name",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full or partial name of the user" },
        },
        required: ["name"],
      },
    },
    {
	name: "list_dms",
	description: "List all direct message conversations and their channel IDs",
	inputSchema: {
	    type: "object",
	    properties: {},
	},
    },
      {
	  name: "send_message",
	  description: "Send a message to a Slack channel or DM",
	  inputSchema: {
	      type: "object",
	      properties: {
		  channelId: { type: "string", description: "The Slack channel or DM ID" },
		  text: { type: "string", description: "The message text to send" },
	      },
	      required: ["channelId", "text"],
	  },
      },      
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_slack") {
    const parts = [];
    if (args.keywords) parts.push(args.keywords);
    if (args.from) parts.push(`from:@${args.from}`);
    if (args.channel) parts.push(`in:${args.channel}`);
    const query = parts.join(" ");

    const results = await searchMessages(query, args.count || 10);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  if (name === "get_channel_history") {
    const results = await getConversationHistory(args.channelId, args.limit || 20);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  if (name === "find_user") {
    const results = await findUser(args.name);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

    if (name === "list_dms") {
	const results = await listDMs();
	return {
	    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
	};
    }

    if (name === "send_message") {
	const result = await sendMessage(args.channelId, args.text);
	return {
	    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
	};
    }    

    throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
