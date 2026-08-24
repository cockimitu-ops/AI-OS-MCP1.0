#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";

// --- Config ---
const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
  console.error("NOTION_API_KEY is required. Set it as an environment variable.");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

// --- Helpers ---

// Pulls plain text out of a Notion rich_text array
function richTextToPlain(richText: any[]): string {
  if (!richText) return "";
  return richText.map((t) => t.plain_text).join("");
}

// Converts a single block to a plain-text line
function blockToText(block: any): string {
  const type = block.type;
  const value = block[type];
  if (!value) return "";

  switch (type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "quote":
    case "callout":
      return richTextToPlain(value.rich_text);
    case "code":
      return "```\n" + richTextToPlain(value.rich_text) + "\n```";
    case "table_row":
      return value.cells.map((cell: any[]) => richTextToPlain(cell)).join(" | ");
    default:
      return "";
  }
}

// Fetches a page's full content as plain text, following child blocks one level deep
// (tables need their rows fetched as children too)
async function getPageContent(pageId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res: any = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of res.results) {
      const text = blockToText(block);
      if (text) lines.push(text);

      // Tables and other containers: fetch their children too
      if (block.has_children && block.type === "table") {
        const rows: any = await notion.blocks.children.list({ block_id: block.id });
        for (const row of rows.results) {
          const rowText = blockToText(row);
          if (rowText) lines.push(rowText);
        }
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

// Finds the first page whose title matches (case-insensitive substring)
async function findPageByTitle(title: string): Promise<{ id: string; title: string; url: string } | null> {
  const res = await notion.search({
    query: title,
    filter: { property: "object", value: "page" },
    page_size: 10,
  });

  for (const result of res.results as any[]) {
    const props = result.properties;
    const titleProp = Object.values(props || {}).find((p: any) => p.type === "title") as any;
    const pageTitle = titleProp ? richTextToPlain(titleProp.title) : "";
    if (pageTitle.toLowerCase().includes(title.toLowerCase())) {
      return { id: result.id, title: pageTitle, url: result.url };
    }
  }
  return null;
}

// --- MCP Server ---

const server = new Server(
  { name: "ai-os-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_vault",
      description:
        "Search Felix's AI OS (synced in Notion) for pages matching a keyword or topic. Returns page titles and URLs, not full content — use get_page for that.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search term, e.g. a project name or topic" } },
        required: ["query"],
      },
    },
    {
      name: "get_page",
      description:
        "Fetch the full content of a specific named page from the AI OS, e.g. 'GetClean', 'Knowledge Core', 'Fulfillment Workflow'.",
      inputSchema: {
        type: "object",
        properties: { page_name: { type: "string", description: "The exact or partial page title" } },
        required: ["page_name"],
      },
    },
    {
      name: "list_projects",
      description:
        "List all active projects in the AI OS with a one-line status each, by reading the '10_Projects' index page.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_project_status",
      description:
        "Fetch the current status of one specific project by name, e.g. 'QuickTurnaroundGigs' or 'GetClean'.",
      inputSchema: {
        type: "object",
        properties: { project_name: { type: "string", description: "The project's name" } },
        required: ["project_name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_vault") {
      const query = (args as any).query as string;
      const res = await notion.search({ query, page_size: 15 });
      const results = (res.results as any[]).map((r) => {
        const props = r.properties;
        const titleProp = Object.values(props || {}).find((p: any) => p.type === "title") as any;
        const title = titleProp ? richTextToPlain(titleProp.title) : "(untitled)";
        return `- ${title} — ${r.url}`;
      });
      return {
        content: [{ type: "text", text: results.length ? results.join("\n") : "No matches found." }],
      };
    }

    if (name === "get_page" || name === "get_project_status") {
      const nameArg = (args as any).page_name || (args as any).project_name;
      const page = await findPageByTitle(nameArg);
      if (!page) {
        return { content: [{ type: "text", text: `No page found matching "${nameArg}".` }] };
      }
      const content = await getPageContent(page.id);
      return {
        content: [{ type: "text", text: `# ${page.title}\n${page.url}\n\n${content}` }],
      };
    }

    if (name === "list_projects") {
      const page = await findPageByTitle("10_Projects");
      if (!page) {
        return { content: [{ type: "text", text: "Could not find the 10_Projects index page." }] };
      }
      const content = await getPageContent(page.id);
      return { content: [{ type: "text", text: content }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// --- Run ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI OS MCP server running (stdio).");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
