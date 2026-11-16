// gmail.js — Gmail sign-in and sending, shared by index.js (Gmail tools) and chtter.js (chtter_send).
// Uses credentials.json / token.json in this folder.
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { authenticate } from "@google-cloud/local-auth";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];
export const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
export const TOKEN_PATH = path.join(__dirname, "token.json");

// Detect MIME type from file extension
export function getMimeType(fileName) {
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

// Load the saved OAuth token, or (if interactive) open a browser to sign in.
// MCP servers started by Claude Desktop can't show a sign-in, so chtter.js
// calls this with { interactive: false } and reports a clear error instead.
export async function authorize({ interactive = true } = {}) {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    const { client_secret, client_id, redirect_uris } = JSON.parse(
      fs.readFileSync(CREDENTIALS_PATH, "utf8")
    ).installed;
    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    client.setCredentials(token);
    return client;
  }
  if (!interactive) {
    throw new Error(
      `Gmail is not signed in (no ${path.basename(TOKEN_PATH)}). ` +
      `Run "node index.js" once from a terminal in ${__dirname} to sign in.`
    );
  }
  const client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials));
  return client;
}

// Subjects with non-ASCII characters (accents, emoji) must be encoded or they arrive garbled.
function encodeHeader(text) {
  return /^[\x00-\x7F]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

const toBase64Url = (s) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Send email — supports optional file attachments
export async function sendEmail(auth, { to, subject, body, cc = [], replyToMessageId = null, attachments = [] }) {
  const gmail = google.gmail({ version: "v1", auth });
  let raw;

  if (attachments.length === 0) {
    // Simple plain-text email
    const lines = [
      `To: ${to.join(", ")}`,
      cc.length ? `Cc: ${cc.join(", ")}` : null,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].filter((l) => l !== null);
    raw = toBase64Url(lines.join("\r\n"));
  } else {
    // Multipart email with attachments
    const boundary = `boundary_${Date.now()}`;
    const headerLines = [
      `To: ${to.join(", ")}`,
      cc.length ? `Cc: ${cc.join(", ")}` : null,
      `Subject: ${encodeHeader(subject)}`,
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
      const base64Data = fs.readFileSync(filePath).toString("base64");
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

    raw = toBase64Url(
      headerLines.join("\r\n") + "\r\n" + bodyPart + attachmentParts.join("") + `--${boundary}--`
    );
  }

  const payload = { raw };
  if (replyToMessageId) {
    const msg = await gmail.users.messages.get({ userId: "me", id: replyToMessageId, format: "metadata" });
    payload.threadId = msg.data.threadId;
  }
  const res = await gmail.users.messages.send({ userId: "me", requestBody: payload });
  return { messageId: res.data.id, threadId: res.data.threadId };
}
