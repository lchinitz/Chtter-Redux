import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { authenticate } from "@google-cloud/local-auth";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/gmail.send",
		"https://www.googleapis.com/auth/gmail.modify"
	       ];
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

// Detect MIME type from file extension
function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    ".pdf":  "application/pdf",
    ".doc":  "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls":  "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt":  "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt":  "text/plain",
    ".csv":  "text/csv",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".zip":  "application/zip",
    ".json": "application/json",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Load or refresh OAuth token
async function authorize() {
  let client;
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    const { client_secret, client_id, redirect_uris } = JSON.parse(
      fs.readFileSync(CREDENTIALS_PATH, "utf8")
    ).installed;
    client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    client.setCredentials(token);
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials));
  return client;
}

// Search emails using Gmail query syntax
async function searchEmails(auth, query, maxResults = 10) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  const messages = res.data.messages || [];
  if (messages.length === 0) return [];
  const details = await Promise.all(
    messages.map((msg) =>
      gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      })
    )
  );
  return details.map((d) => {
    const headers = d.data.payload.headers;
    const get = (name) => headers.find((h) => h.name === name)?.value || "";
    return {
      id: d.data.id,
      threadId: d.data.threadId,
      from: get("From"),
      to: get("To"),
      subject: get("Subject"),
      date: get("Date"),
      snippet: d.data.snippet,
    };
  });
}

// Get full body of a single email
async function getEmail(auth, messageId) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const headers = res.data.payload.headers;
  const get = (name) => headers.find((h) => h.name === name)?.value || "";
  let body = "";
  const parts = res.data.payload.parts || [];
  const textPart = parts.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) {
    body = Buffer.from(textPart.body.data, "base64").toString("utf8");
  } else if (res.data.payload.body?.data) {
    body = Buffer.from(res.data.payload.body.data, "base64").toString("utf8");
  }
  return {
    id: res.data.id,
    from: get("From"),
    to: get("To"),
    subject: get("Subject"),
    date: get("Date"),
    body,
  };
}

// Send email — supports optional file attachments
async function sendEmail(auth, { to, subject, body, cc = [], replyToMessageId = null, attachments = [] }) {
  const gmail = google.gmail({ version: "v1", auth });
  let raw;

  if (attachments.length === 0) {
    // Simple plain-text email (original behavior)
    const lines = [
      `To: ${to.join(", ")}`,
      cc.length ? `Cc: ${cc.join(", ")}` : null,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].filter((l) => l !== null);
    raw = Buffer.from(lines.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } else {
    // Multipart email with attachments
    const boundary = `boundary_${Date.now()}`;
    const headerLines = [
      `To: ${to.join(", ")}`,
      cc.length ? `Cc: ${cc.join(", ")}` : null,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
    ].filter((l) => l !== null);

    const bodyPart =
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      `${body}\r\n`;

    const attachmentParts = attachments.map((filePath) => {
      const fileName = path.basename(filePath);
      const fileData = fs.readFileSync(filePath);
      const base64Data = fileData.toString("base64");
      const mimeType = getMimeType(fileName);
      return (
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}; name="${fileName}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${fileName}"\r\n` +
        `\r\n` +
        `${base64Data}\r\n`
      );
    });

    const message =
      headerLines.join("\r\n") +
      "\r\n" +
      bodyPart +
      attachmentParts.join("") +
      `--${boundary}--`;

    raw = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  const payload = { raw };
  if (replyToMessageId) {
    const msg = await gmail.users.messages.get({ userId: "me", id: replyToMessageId, format: "metadata" });
    payload.threadId = msg.data.threadId;
  }
  const res = await gmail.users.messages.send({ userId: "me", requestBody: payload });
  return { messageId: res.data.id, threadId: res.data.threadId };
}

// Delete Email
async function trashEmail(auth, messageId) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.trash({ userId: "me", id: messageId });
  return { messageId: res.data.id, labelIds: res.data.labelIds };
}

async function listLabels(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.labels.list({ userId: "me" });
  return res.data.labels.map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

async function moveEmail(auth, messageId, addLabelIds = [], removeLabelIds = []) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return { messageId: res.data.id, labelIds: res.data.labelIds };
}

async function createLabel(auth, name) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return { id: res.data.id, name: res.data.name };
}

// --- MCP Server Setup ---
const server = new Server(
  { name: "gmail-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);
let authClient;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_emails",
      description: "Search Gmail messages by sender, subject, and/or keywords",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Raw Gmail query string (e.g. 'from:sonny@pacifi.com newer_than:30d')" },
          from: { type: "string", description: "Sender email address" },
          subject: { type: "string", description: "Subject line keywords" },
          keywords: { type: "string", description: "Keywords to search in body" },
          maxResults: { type: "number", description: "Max number of results (default 10)" },
        },
      },
    },
    {
      name: "get_email",
      description: "Get the full body of an email by its message ID",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Gmail message ID" },
        },
        required: ["messageId"],
      },
    },
    {
      name: "send_email",
      description: "Send an email via Gmail, with optional file attachments",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Plain text email body" },
          cc: { type: "array", items: { type: "string" }, description: "CC recipients (optional)" },
          replyToMessageId: { type: "string", description: "Message ID to reply to, keeps thread (optional)" },
          attachments: {
            type: "array",
            items: { type: "string" },
            description: "Absolute file paths to attach (optional), e.g. ['C:\\Users\\leigh\\Documents\\report.pdf']",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "trash_email",
      description: "Move an email to the trash by its message ID",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Gmail message ID to trash" },
        },
        required: ["messageId"],
      },
    },
    {
      name: "list_labels",
      description: "List all Gmail labels/folders",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "move_email",
      description: "Move an email to a folder by adding/removing Gmail labels",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Gmail message ID" },
          addLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to add" },
          removeLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to remove" },
        },
        required: ["messageId"],
      },
    },
      {
	  name: "create_label",
	  description: "Create a new Gmail label/folder",
	  inputSchema: {
	      type: "object",
	      properties: {
		  name: { type: "string", description: "Label name, e.g. 'INBOX/Chtter Redux' for a subfolder of Inbox" },
	      },
	      required: ["name"],
	  },
      },      
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_emails") {
    const parts = [];
    if (args.query) parts.push(args.query);
    if (args.from) parts.push(`from:${args.from}`);
    if (args.subject) parts.push(`subject:${args.subject}`);
    if (args.keywords) parts.push(args.keywords);
    const query = parts.join(" ");
    const results = await searchEmails(authClient, query, args.maxResults || 10);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }

  if (name === "get_email") {
    const result = await getEmail(authClient, args.messageId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "send_email") {
    const result = await sendEmail(authClient, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "trash_email") {
    const result = await trashEmail(authClient, args.messageId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "list_labels") {
    const result = await listLabels(authClient);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "move_email") {
    const result = await moveEmail(authClient, args.messageId, args.addLabelIds || [], args.removeLabelIds || []);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

    if (name === "create_label") {
	const result = await createLabel(authClient, args.name);
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }    

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
authClient = await authorize();
await server.connect(transport);
