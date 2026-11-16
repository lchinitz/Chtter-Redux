# Chtter-Redux

Chtter sends one message to every contact method a person currently has turned on
(email, text, WhatsApp). Contact settings live in a MySQL database on AWS. The sending
is done by an AI model through **MCP servers** (small local programs that give a model
tools). Two apps can drive those tools:

- **Claude Desktop**, using Claude.
- **LLM Coding Harness**, a hand-built web page for local **Ollama** models.

> Last updated: 16 November 2026, after moving to a new Windows machine.
> If you're coming back to this after a while, read **Current status** and
> **Getting it running** first.

---

## Current status (November 2026)

| Piece | State |
|---|---|
| Contact database (AWS RDS) | ✅ Working |
| `chtter-server` REST API + web page | ✅ Working on the new machine; security fixes still to do (see Roadmap) |
| MCP: database tools (`mySQL.js`) | ✅ Working in Claude Desktop and the harness |
| MCP: Gmail tools (`index.js`) | ✅ Working |
| MCP: Slack tools (`slack.js`) | ✅ Working (`slack-token.json` restored) |
| LLM Coding Harness with MCP support | ✅ Working (tool calls, approvals, context management) |
| "chtter" itself | ✅ `chtter_send` tool (`Chtter-MCP/chtter.js`); the Claude skill now just calls it |
| Email channel | ✅ Works (via Gmail) |
| Text (SMS) channel | ❌ No sender. See **Channel decisions** |
| WhatsApp channel | ❌ Removed on purpose. See **Channel decisions** |

---

## How the pieces fit together

```
 Claude Desktop ─┐                         ┌─ "database" MCP (Chtter-MCP/mySQL.js) ──HTTP──▶ chtter-server :8787 ──▶ AWS RDS MySQL
                 │                         ├─ "chtter"   MCP (Chtter-MCP/chtter.js) ──HTTP──▶ chtter-server (contacts)
                 ├── starts & talks to ────┤                                        └───────▶ Gmail API (via gmail.js)
 LLM Harness  ───┘   (MCP over stdio)      ├─ "gmail"    MCP (Chtter-MCP/index.js)  ──────▶ Gmail API (via gmail.js)
                                           └─ "slack"    MCP (Chtter-MCP/slack.js)  ──────▶ Slack API
  :3456 ──▶ Ollama :11434
```

- Each MCP server is a separate program. The **app** (Claude Desktop or the harness)
  starts them and is the only thing that can call their tools; servers cannot call
  each other.
- `chtter-server` must be running separately; the database MCP server only forwards to it.

### chtter-server/ — contact database API + web page

| File | What it does |
|---|---|
| `chtter-server.js` | Express REST API on **port 8787**. Talks to the `chtter` database on AWS RDS. |
| `index.html`, `chtter-client.js` | Small web page at http://localhost:8787. Type a user name to get a checkbox per channel to turn it on or off. |
| `.env`, `global-bundle.pem` | Not in git. See **Secret files**. |

REST endpoints (all GET, with query-string parameters):

| Endpoint | Parameters |
|---|---|
| `/getUsers/` | — |
| `/getContacts/` | `userName` |
| `/upsertContact/` | `userName`, `contactType`, `contactValue`, `active` (`true`/`false`) |
| `/deleteContact/` | `userName`, `contactType` |
| `/addUser/` | `userName` |
| `/deleteUser/` | `userName` |

Quick check that it's working: http://localhost:8787/getContacts/?userName=leigh

### Chtter-MCP/ — MCP servers

Each file is a separate MCP server.

| File | Name in Claude config | Tools | Needs |
|---|---|---|---|
| `chtter.js` | `chtter` | **chtter_send** | `chtter-server` running; Gmail `token.json` |
| `mySQL.js` | `database` | get_users, get_contacts, upsert_contact, delete_contact, add_user, delete_user | `chtter-server` running on 8787 |
| `index.js` | `gmail` | search_emails, get_email, send_email, trash_email, list_labels, move_email, create_label | `credentials.json`, `token.json` |
| `slack.js` | `slack` | search_slack, get_channel_history, find_user, list_dms, send_message | `slack-token.json` |
| `gmail.js` | (not a server) | Shared Gmail sign-in and sending, used by `index.js` and `chtter.js` | — |

### The chtter_send tool

`chtter_send(userName, message, subject?, dryRun?)` is in `Chtter-MCP/chtter.js`. It:
1. looks up the user's contacts through chtter-server,
2. sends through each channel that is **on** and has a sender,
3. returns a report for every channel.

Example report:

```
Sent to 1 channel(s) for leigh, 1 skipped.
email     lchinitz@aya.yale.edu   sent       (Gmail message …)
text      7182483952              skipped    (no sender configured for this channel)
whatsapp  7812483952              off
```

- Channel statuses: `sent`, `failed` (with the reason), `skipped` (no sender for that
  channel yet), `off` (turned off for this user), and `would send` (dry run).
- **`dryRun: true`** previews the report without sending anything.
- The subject defaults to "Chtter".
- **Senders:** email only for now. Text and WhatsApp are `null` in the `SENDERS` table at
  the top of `chtter.js`. Adding a channel means writing one function there.
- Gmail sign-in happens on first use, and never opens a browser from inside Claude or the
  harness. If `token.json` is missing, the report says to run `node index.js` once.
- In the harness, `chtter_send` asks for approval, since it isn't a read-only tool. One
  approval covers all channels.
- The Claude **"chtter" skill** just calls this tool. "chtter <message>" with no user named means Leigh.

### LLM Coding Harness (`simpleHarness` folder, not in this repo)

A hand-built chat page for Ollama, extended to use the same MCP servers.

| File | What it does |
|---|---|
| `server.js` | Express on **port 3456, this machine only**. Forwards chats to Ollama and acts as the MCP client: starts the servers listed in `mcp.json`, offers their tools to the model, runs the tool calls, asks for approval when needed. |
| `app.js`, `index.html`, `style.css` | The chat page: files, parameters, streaming replies, thinking, tool-call blocks, Approve/Deny, Stop, context meter. |
| `mcp.json` | The MCP servers to start, in the same format as Claude Desktop's config. |

How tools behave in the harness:
- **Read-only tools run automatically**: names starting with `get_`, `list_`, `search_`, `find_`, `read_`.
  **Everything else asks first** (Approve / Deny in the chat). Unanswered requests are
  denied after 5 minutes. To choose the auto-approved tools for one server yourself,
  add `"autoApprove": ["tool_a", "tool_b"]` to its entry in `mcp.json`.
- **Context management:** a footer meter shows how full the context window is. When a
  request won't fit, the oldest tool results are shortened to a stub first; your messages
  and the model's answers are never removed. This stops Ollama from silently dropping
  your question, which made Qwen3 fail with "No user query found in messages".
- **Parameters panel:** context window (default 32,768), temperature, max output,
  thinking, MCP tools on/off, tool result limit (default 8,000 characters), and a
  checkbox per server. Settings are remembered in the browser.
- **Models without tool support** answer without tools, and the page tells you so.
- Only tool-capable models can use tools: Qwen3, Llama 3.1+, Mistral, gpt-oss and others.
- **`mcp.json` must be in the `simpleHarness` folder.** The harness reads only that copy,
  and only when it starts, so restart it after editing.
- **Name the user when you chtter from the harness**, e.g. "chtter leigh: …". The rule
  "no user named means Leigh" lives in the Claude skill, which the harness doesn't have.
  `chtter_send` asks for approval each time, including dry runs.

---

## Database

AWS RDS MySQL, region us-west-2.

- Host: `chtter-mcp-database.cp1vvnnejoms.us-west-2.rds.amazonaws.com`, port 3306
- Database: `chtter`; user: `admin` (password in `chtter-server/.env`)
- The RDS **security group** only allows listed IP addresses. On a new machine or
  network, add your public IP for port 3306, or connections will time out.
- Command line:
  `mysql -h <host> -P 3306 -u admin -p --ssl-mode=VERIFY_IDENTITY --ssl-ca=./global-bundle.pem`
- GUI: DBeaver. (MySQL Workbench stopped working.)

### Schema

The real schema is in **`schema.sql`** at the repo root (exported from RDS through DBeaver,
16 November 2026). To recreate the tables on a new server: `mysql -h <host> -u admin -p < schema.sql`.

```sql
CREATE TABLE `users` (
  `user_id`  int NOT NULL AUTO_INCREMENT,
  `userName` varchar(100) NOT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `userName` (`userName`)
);

CREATE TABLE `contacts` (
  `contact_id`    int NOT NULL AUTO_INCREMENT,
  `user_id`       int NOT NULL,
  `contact_type`  enum('email','text','whatsapp') NOT NULL,
  `contact_value` varchar(255) NOT NULL,
  `active`        tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`contact_id`),
  UNIQUE KEY `unique_user_contact_type` (`user_id`,`contact_type`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
);
```

Things worth knowing:
- **One contact per channel per user.** `upsertContact` depends on the unique key on (user, channel).
- **`contact_type` is a fixed list** (email, text, whatsapp). A new channel, such as slack,
  needs an `ALTER TABLE … MODIFY contact_type enum(…)` first.
- **New contacts start turned off** (`active` defaults to 0).
- **Deleting a user also deletes all their contacts** (`ON DELETE CASCADE`).
- Contact IDs jump, e.g. to 107, because MySQL uses up an ID on every
  `INSERT … ON DUPLICATE KEY UPDATE`, even when it only updates. That's harmless.

To export the schema again: in DBeaver's Navigator, open **chtter → Tables**, select all the
tables, right-click → **Generate SQL → DDL** → Copy.

---

## Secret / local files (not in git — recreate on a new machine)

`.gitignore` excludes these on purpose. Copy them over by hand or regenerate them.

| File | Where | How to get it |
|---|---|---|
| `.env` | `chtter-server/` | One line: `DB_PWD=<RDS admin password>`. Save it as ASCII/UTF-8, and make sure it isn't named `.env.txt`. If the password is lost, reset it under RDS → Databases → chtter-mcp-database → Modify. |
| `global-bundle.pem` | `chtter-server/` | A public file from AWS: `curl -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` |
| `credentials.json` | `Chtter-MCP/` | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (type: Desktop app) → download JSON. |
| `token.json` | `Chtter-MCP/` | Created on first run of `index.js`, which opens a browser to sign in. **Do the first run from a terminal**: `node index.js`. If Gmail stops working, delete this file and run again. |
| `slack-token.json` | `Chtter-MCP/` | `{ "SLACK_TOKEN": "xoxp-…" }`. Get it from https://api.slack.com/apps → your app → **OAuth & Permissions**. `search_slack` needs a **user** token (`xoxp-`); a bot token (`xoxb-`) can't search. |
| `database.js` | `chtter-server/` | Old file, **no longer used**. Remove the `require` for it. |

---

## Getting it running (Windows)

Project folder: `C:\Users\lchin\Documents\Chtter-Redux`

1. **Install dependencies** in each folder:
   ```powershell
   cd C:\Users\lchin\Documents\Chtter-Redux\chtter-server; npm install
   cd C:\Users\lchin\Documents\Chtter-Redux\Chtter-MCP;    npm install
   cd <path>\simpleHarness;                                       npm install   # needs @modelcontextprotocol/sdk
   ```
2. **Put the secret files in place** (table above).
3. **Start the REST server** and leave the window open:
   ```powershell
   cd C:\Users\lchin\Documents\Chtter-Redux\chtter-server
   node chtter-server.js
   ```
   You should see `REST endpoint now listening on port 8787.` Then check
   http://localhost:8787/getContacts/?userName=leigh in a browser.
4. **First-time Gmail sign-in** (only when `token.json` is missing):
   `cd ..\Chtter-MCP; node index.js`, complete the browser sign-in, then press Ctrl+C.
5. **Then either or both:**
   - **Claude Desktop:** configure it as below, then quit it from the system tray and reopen it.
   - **Harness:** make sure Ollama is running, then `cd <path>\simpleHarness; node server.js`.
     It opens http://localhost:3456 and prints how many tools each MCP server provided.

---

## Claude Desktop configuration

Open it with **Settings → Developer → Edit Config**. Where the file lives depends on how Claude was installed:

- Standard installer: `%APPDATA%\Claude\claude_desktop_config.json`
- Microsoft Store install:
  `C:\Users\<you>\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "database": {
      "command": "node",
      "args": ["C:\\Users\\lchin\\Documents\\Chtter-Redux\\Chtter-MCP\\mySQL.js"]
    },
    "chtter": {
      "command": "node",
      "args": ["C:\\Users\\lchin\\Documents\\Chtter-Redux\\Chtter-MCP\\chtter.js"]
    },
    "gmail": {
      "command": "node",
      "args": ["C:\\Users\\lchin\\Documents\\Chtter-Redux\\Chtter-MCP\\index.js"]
    },
    "slack": {
      "command": "node",
      "args": ["C:\\Users\\lchin\\Documents\\Chtter-Redux\\Chtter-MCP\\slack.js"]
    }
  }
}
```

The harness's `mcp.json` uses the same format and the same names.

> Before November 2026, the Gmail server (`index.js`) was named `chtter` in Claude Desktop. It's now `gmail`, and `chtter` is the new `chtter.js`.

---

## Channel decisions (November 2026)

**Email:** sent through the Gmail API from your own address. ✅

**WhatsApp: removed.** The old setup (`whatsapp-mcp` plus a Go "bridge") connected to
WhatsApp by pretending to be WhatsApp Web, using an unofficial library. It's unsupported,
can break without warning, and may put the account at risk.
- No official API exists for personal WhatsApp accounts.
- The only official route is Meta's **WhatsApp Business Platform**, directly or through
  Twilio. It needs a separate business number, pre-approved message templates for first
  contact, and per-message fees. Messages would come from a "Chtter" number, not from you.

**Text (SMS): no sender yet.** Ideas considered:
- **Twilio from your existing cell number:** not possible. Twilio's "Hosted SMS" excludes
  mobile numbers, and porting would take the number off your phone.
- **An Android SMS-gateway app on your phone** (e.g. SMS Gateway for Android,
  sms-gate.app, in its local-network mode): sends from your real number. **Ruled out:**
  it has to be installed outside the Play Store, and the phone is corporate-managed.
- **Twilio with a new number:** clean and supported. Requires US carrier registration for
  app-sent texts, plus a small monthly cost. It's an option if a separate number is acceptable,
  and Twilio could later handle WhatsApp too.
- A **spare personal Android phone** with its own SIM could run a gateway app, but that's
  also a different number.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot find module './database.js'` | That file was never in git, and nothing uses it. Remove the `require`. |
| `injected env (0) from .env` and then `Access denied … (using password: NO)` | `.env` is missing, empty, saved as UTF-16, or named `.env.txt`. |
| `ENOENT … C:\Windows\system32\global-bundle.pem` | Claude Desktop starts programs from `system32`. File paths in code must use `path.join(__dirname, …)`, never `./`. |
| Claude Desktop says the config is invalid | The JSON is broken: an extra `{ }` or a trailing comma. Check it with jsonlint.com. |
| An MCP server shows `Connection closed` | The config points at a file that isn't an MCP server (e.g. `chtter-server.js`), the server crashed at startup, or its port is in use. See `…\Claude\logs\mcp-server-<name>.log`. |
| Database tools return `fetch failed` | `chtter-server.js` isn't running, or it crashed. |
| Harness: "conversation no longer fits in the context window" (formerly Qwen3's "No user query found in messages") | Start a New Chat, raise **Context window**, or lower **Tool result limit**. Ask for headers (`search_emails`) rather than full bodies (`get_email`) when that's enough. |
| Harness: "*model* can't use tools" | That model has no tool support. Pick Qwen3, Llama 3.1+, Mistral, gpt-oss, etc. |
| Gmail stops working after about a week | If the Google OAuth app is in **Testing** status, Google expires its sign-in tokens after 7 days. Delete `token.json` and sign in again, or publish the app (it can stay unverified for personal use). |
| An MCP server prints to the console and breaks | Never use `console.log` in an MCP server: stdout is the channel to the app. Use `console.error`. |
| Test an MCP server on its own | `npx @modelcontextprotocol/inspector node <path-to-server.js>` |

---

## Roadmap / known issues

### Next: chtter-server security and clean-up
- [ ] Use `?` placeholders in every SQL query. Right now every endpoint is open to SQL injection.
- [ ] Listen on `127.0.0.1` only, and restrict `cors()` to its own page. Currently anyone
      on the network can call `deleteUser`.
- [ ] Parse parameters with `request.query`. Only `contactValue` is URL-decoded today.
- [ ] Remove the `database.js` require, the dead `homePage()`, and the unused packages `aws-sdk`, `request`, `mysql`,
      plus the stray npm packages `database` and `database.js`.
- [ ] Serve only `index.html` and `chtter-client.js`, not the whole folder.
- [ ] Turn certificate checking back on (`rejectUnauthorized: true`), matching the command-line setup.
- [ ] Use a connection pool instead of a new connection per query.
- [ ] Later: change the endpoints that modify data from GET to POST. This needs `mySQL.js` and `chtter-client.js` updated too.

### Done: `chtter_send` tool (November 2026)
- [x] `Chtter-MCP/chtter.js` with `chtter_send(userName, message, subject?, dryRun?)`
- [x] Gmail sign-in and sending moved into the shared `gmail.js`. Gmail tools unchanged, except that non-ASCII subjects are now encoded correctly.
- [x] Email channel works. Text and WhatsApp are reported as "skipped".
- [x] Claude skill updated to call `chtter_send`.
- [ ] When an SMS or WhatsApp sender is added: phone numbers are stored as `7182483952`, and
      most APIs need `+17182483952`.

### MCP server fixes
- [ ] `upsert_contact` with `active` left out turns the channel **off**. Make it default to on, or make it required.
- [ ] Gmail `get_email` returns an empty body for nested multipart messages.
- [ ] Gmail `send_email` can attach any file path on disk. That's worth knowing for a tool an AI can call.
- [ ] Remove the unused packages `aws-sdk` and `mysql2` from `Chtter-MCP/package.json`.

### Housekeeping
- [x] Export the real `schema.sql`.
- [ ] Commit `schema.sql`.
- [ ] Put the harness under version control, in this repo or its own.
- [ ] `chtter-redux.sh` (Linux launcher) still starts the WhatsApp bridge, and its paths are hard-coded. Update or delete it.
- [ ] Delete `Chtter-MCP/NOTES`; everything in it is now in this README.

---

## Reproducing everything from scratch

What it takes to rebuild the whole system on a new machine, or for someone else.

### 1. Accounts and cloud services
- [ ] **AWS account → RDS MySQL instance**
  - Create a MySQL instance with a master user (`admin`) and password. Enable public access.
  - Create the `chtter` database and its tables: `mysql -h <host> -u admin -p < schema.sql`.
  - Security group: allow inbound port 3306 from your public IP.
  - Add at least one user and their contacts, through the web page or the MCP tools.
- [ ] **Google Cloud project for Gmail**
  - Enable the **Gmail API**.
  - Configure the **OAuth consent screen** (External). Add yourself as a test user, or publish the app.
  - Create an **OAuth client ID** of type **Desktop app** and download it as `credentials.json`.
  - Scopes used: `gmail.readonly`, `gmail.send`, `gmail.modify`.
- [ ] **Slack app** (https://api.slack.com/apps) in your workspace
  - **User token** scopes: `search:read`, `channels:history`, `groups:history`, `im:history`,
    `mpim:history`, `im:read`, `users:read`, `users:read.email`, `chat:write`.
  - Install it to the workspace and copy the **User OAuth Token** (`xoxp-…`).
- [ ] **Claude account** with Claude Desktop, if you use Claude.
- [ ] Optional, for text or WhatsApp later: a Twilio account (see **Channel decisions**).

### 2. Software on the machine
- [ ] **Node.js** (v22 or newer; the project was last run on v26) and **git**.
- [ ] **Claude Desktop**, and/or **Ollama** with at least one tool-capable model
      (e.g. `ollama pull qwen3:8b`). Larger models are more reliable with tools.
- [ ] Optional: a MySQL command-line client and/or **DBeaver**.

### 3. Code
- [ ] `git clone` this repo (Chtter-Redux).
- [ ] Copy the **`simpleHarness`** folder; it isn't in this repo yet.
- [ ] `npm install` in `chtter-server/`, `Chtter-MCP/` and the harness folder.
- [ ] Recreate the Claude **"chtter" skill** (it only says: call `chtter_send`; no user named means Leigh).

### 4. Secrets and config
- [ ] `chtter-server/.env` containing `DB_PWD=…`
- [ ] `chtter-server/global-bundle.pem` (download command above)
- [ ] `Chtter-MCP/credentials.json`, then run `node index.js` once to create `token.json`
- [ ] `Chtter-MCP/slack-token.json`
- [ ] Claude Desktop config (`mcpServers` block above), with paths for the new machine
- [ ] Harness `mcp.json`, with the same servers and paths

### 5. Start and check
- [ ] `node chtter-server.js`, then http://localhost:8787/getContacts/?userName=<user> returns JSON
- [ ] Claude Desktop: quit fully and reopen. Ask "what Chtter channels are on for <user>?"
- [ ] Harness: `node server.js`. The console lists each MCP server's tool count, and the page loads at http://localhost:3456
- [ ] `chtter_send` with `dryRun: true` lists the right channels. Then send a real chtter to yourself and confirm the email arrives.
