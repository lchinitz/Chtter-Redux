// chtter.js — MCP server with one tool: chtter_send.
// Sends a message to every contact method a user has turned on, and reports per channel.
//
//   Contacts come from chtter-server's REST API (must be running, default http://localhost:8787).
//   Email goes out through Gmail (shared code in gmail.js; needs token.json from "node index.js").
//   Text and WhatsApp have no sender yet, so they are reported as skipped.
//
// To add a channel later, add one function to SENDERS below.
//
// Never use console.log in an MCP server (stdout is the channel to the app); use console.error.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { authorize, sendEmail } from "./gmail.js";

const API_BASE = process.env.CHTTER_API || "http://localhost:8787";
const DEFAULT_SUBJECT = "Chtter";

// ── Contacts ───────────────────────────────────────────────────────

async function getContacts(userName) {
  let res;
  try {
    res = await fetch(`${API_BASE}/getContacts?userName=${encodeURIComponent(userName)}`);
  } catch (err) {
    throw new Error(`Can't reach chtter-server at ${API_BASE}. Is "node chtter-server.js" running? (${err.message})`);
  }
  if (!res.ok) throw new Error(`chtter-server error: ${res.status} ${res.statusText}`);
  return res.json();
}

// ── Senders: one function per channel ──────────────────────────────
// Each returns a short detail string on success, or throws.
// A sender set to null means "no way to send on this channel yet".

let gmailAuth = null;   // signed in on first use, so a Gmail problem never blocks startup

const SENDERS = {
  async email(to, message, subject) {
    gmailAuth ??= await authorize({ interactive: false });
    const r = await sendEmail(gmailAuth, { to: [to], subject, body: message });
    return `Gmail message ${r.messageId}`;
  },
  text: null,        // no SMS sender configured (see README: Channel decisions)
  whatsapp: null,    // removed on purpose (see README: Channel decisions)
};

// ── chtter_send ────────────────────────────────────────────────────

async function chtterSend({ userName, message, subject, dryRun = false }) {
  if (!userName?.trim()) throw new Error("userName is required.");
  if (!message?.trim()) throw new Error("message is required.");
  subject = subject?.trim() || DEFAULT_SUBJECT;

  const contacts = await getContacts(userName.trim());
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error(`No contacts found for user "${userName}". Check the user name (get_users lists them).`);
  }

  const results = [];
  for (const c of contacts) {
    const entry = { channel: c.contact_type, to: c.contact_value };
    const active = c.active === 1 || c.active === true || c.active === "1";

    if (!active) {
      entry.status = "off";
    } else if (!(c.contact_type in SENDERS) || SENDERS[c.contact_type] === null) {
      entry.status = "skipped";
      entry.detail = "no sender configured for this channel";
    } else if (dryRun) {
      entry.status = "would send";
    } else {
      try {
        entry.detail = await SENDERS[c.contact_type](c.contact_value, message, subject);
        entry.status = "sent";
      } catch (err) {
        entry.status = "failed";
        entry.detail = err.message;
      }
    }
    results.push(entry);
  }

  const count = (s) => results.filter((r) => r.status === s).length;
  const sent = count("sent"), failed = count("failed"), skipped = count("skipped"), would = count("would send");

  let summary;
  if (dryRun) {
    summary = would
      ? `Dry run: would send to ${would} channel(s) for ${userName}. Nothing was sent.`
      : `Dry run: nothing would be sent for ${userName}. No active channel has a sender.`;
  } else if (sent === 0 && failed === 0) {
    summary = `Nothing sent to ${userName}: no active channel has a sender.`;
  } else {
    summary = `Sent to ${sent} channel(s) for ${userName}` +
      (failed ? `, ${failed} FAILED` : "") +
      (skipped ? `, ${skipped} skipped` : "") + ".";
  }

  return { summary, userName, subject, dryRun, results, anyFailed: failed > 0, nothingSent: !dryRun && sent === 0 };
}

// ── MCP server ─────────────────────────────────────────────────────

const server = new Server(
  { name: "chtter-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "chtter_send",
      description:
        "Chtter: send one message to every contact method a user currently has turned on " +
        "(email, text, WhatsApp), and report what happened on each channel. " +
        "Use this whenever the user says 'chtter' or asks to chtter someone. " +
        "Channels that are off are not used; channels with no sender yet are reported as skipped. " +
        "Use dryRun to preview without sending.",
      inputSchema: {
        type: "object",
        properties: {
          userName: { type: "string", description: "The Chtter user name, e.g. 'leigh'" },
          message: { type: "string", description: "The message to send" },
          subject: { type: "string", description: `Email subject (optional, default '${DEFAULT_SUBJECT}')` },
          dryRun: { type: "boolean", description: "If true, report what would be sent without sending anything" },
        },
        required: ["userName", "message"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "chtter_send") throw new Error(`Unknown tool: ${name}`);

  try {
    const result = await chtterSend(args || {});
    return {
      content: [{ type: "text", text: result.summary + "\n\n" + JSON.stringify(result.results, null, 2) }],
      isError: result.anyFailed,
    };
  } catch (err) {
    return { content: [{ type: "text", text: `chtter_send failed: ${err.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error(`chtter MCP server running (contacts from ${API_BASE})`);
