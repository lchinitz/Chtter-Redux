import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = "http://localhost:4444";

//#######
async function getUsers() {
  const res = await fetch(`${API_BASE}/getUsers`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

//#######
async function getContacts(userName) {
  const res = await fetch(`${API_BASE}/getContacts?userName=${encodeURIComponent(userName)}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

//#######
async function upsertContact(userName, contactType, contactValue, active) {
  const res = await fetch(
      `${API_BASE}/upsertContact?userName=${encodeURIComponent(userName)}&contactType=${encodeURIComponent(contactType)}&contactValue=${encodeURIComponent(contactValue)}&active=${active}`
  );
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

//#######
async function deleteContact(userName, contactType) {
  const res = await fetch(
    `${API_BASE}/deleteContact?userName=${encodeURIComponent(userName)}&contactType=${encodeURIComponent(contactType)}`
  );
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}


//#######
async function addUser(userName) {
  const res = await fetch(`${API_BASE}/addUser?userName=${encodeURIComponent(userName)}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

//#######
async function deleteUser(userName) {
  const res = await fetch(`${API_BASE}/deleteUser?userName=${encodeURIComponent(userName)}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

const server = new Server(
  { name: "mysql-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_users",
      description: "Get all users in the database",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "get_contacts",
      description: "Get contacts for a user from the database",
      inputSchema: {
        type: "object",
        properties: {
          userName: { type: "string", description: "The username to look up contacts for" },
        },
        required: ["userName"],
      },
    },
      {
	  name: "upsert_contact",
	  description: "Add a new contact method for a user, or update it if that type already exists",
	  inputSchema: {
              type: "object",
              properties: {
		  userName: { type: "string", description: "The username to add/update a contact for" },
		  contactType: { type: "string", enum: ["email", "text", "whatsapp"], description: "The contact method type" },
		  contactValue: { type: "string", description: "The contact address/value, e.g. an email or phone number" },
		  active: { type: "boolean", description: "Indication of whether this contact method is active or not" },
              },
              required: ["userName", "contactType", "contactValue"],
	  },
      },
      {
	  name: "delete_contact",
	  description: "Remove a specific contact method from a user's record",
	  inputSchema: {
              type: "object",
              properties: {
		  userName: { type: "string", description: "The username to delete a contact from" },
		  contactType: { type: "string", enum: ["email", "text", "whatsapp"], description: "The contact method type to delete" },
              },
              required: ["userName", "contactType"],
	  },
      },
    {
      name: "add_user",
      description: "Add a new user to the database",
      inputSchema: {
        type: "object",
        properties: {
          userName: { type: "string", description: "The username to add." },
        },
        required: ["userName"],
      },
    },      
    {
      name: "delete_user",
      description: "Delete a user from the database",
      inputSchema: {
        type: "object",
        properties: {
          userName: { type: "string", description: "The username to delete." },
        },
        required: ["userName"],
      },
    }
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_users") {
    const result = await getUsers();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
    
  if (name === "get_contacts") {
    const result = await getContacts(args.userName);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

    if (name === "upsert_contact") {
	const result = await upsertContact(args.userName, args.contactType, args.contactValue, args.active);
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === "delete_contact") {
	const result = await deleteContact(args.userName, args.contactType);
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "add_user") {
	const result = await addUser(args.userName);
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === "delete_user") {
	const result = await deleteUser(args.userName);
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
