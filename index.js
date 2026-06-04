import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "filament-v5-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

const BASE = "https://filamentphp.com/docs/5.x";
const LLMS_TXT = "https://filamentphp.com/docs/llms.txt";

// ─── LRU Cache ───────────────────────────────────────────────────────────────

const CACHE_MAX = 20;
const DOC_TTL = 60 * 60 * 1000; // 1 hour for doc pages
const INDEX_TTL = 3 * 60 * 60 * 1000; // 3 hours for llms.txt index
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  // LRU: re-insert to move to end
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key, data, ttl) {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest (first key)
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now(), ttl });
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function fetchText(url, ttl = DOC_TTL) {
  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  cacheSet(url, text, ttl);
  return text;
}

// ─── Markdown Cleaner ────────────────────────────────────────────────────────
// Strips Mintlify JSX components, sponsor blocks, screenshot tags, and
// code-fence theme metadata that waste agent tokens.

function cleanMarkdown(md) {
  let out = md;

  // Remove JSX component definitions (export const AutoScreenshot = ...; etc.)
  // These are multi-line JSX blocks that end with `};`
  out = out.replace(/^export const \w+[\s\S]*?^};$/gm, "");

  // Remove <AutoScreenshot ... /> tags
  out = out.replace(/<AutoScreenshot[^>]*\/>/g, "");

  // Remove <EditOnGitHub ... /> and <Footer /> component invocations
  out = out.replace(/<EditOnGitHub[^>]*\/>/g, "");
  out = out.replace(/<Footer\s*\/>/g, "");

  // Convert Mintlify admonitions to standard markdown blockquotes
  out = out.replace(/<Tip>([\s\S]*?)<\/Tip>/g, (_, content) => {
    return `> **Tip:** ${content.trim()}`;
  });
  out = out.replace(/<Warning>([\s\S]*?)<\/Warning>/g, (_, content) => {
    return `> **Warning:** ${content.trim()}`;
  });
  out = out.replace(/<Danger>([\s\S]*?)<\/Danger>/g, (_, content) => {
    return `> **Danger:** ${content.trim()}`;
  });
  out = out.replace(/<Note>([\s\S]*?)<\/Note>/g, (_, content) => {
    return `> **Note:** ${content.trim()}`;
  });
  out = out.replace(/<Info>([\s\S]*?)<\/Info>/g, (_, content) => {
    return `> **Info:** ${content.trim()}`;
  });

  // Strip theme metadata from code fences: ```php theme={"theme":"gruvbox-dark-hard"}
  out = out.replace(
    /```(\w+)\s+theme=\{[^}]*\}/g,
    "```$1"
  );

  // Remove inline images (agents don't need screenshots)
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // Collapse 3+ blank lines to 2
  out = out.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  return out.trim();
}

// ─── Section Extractor ───────────────────────────────────────────────────────
// Returns only the content under a specific heading (case-insensitive match).
// Uses heading hierarchy: extracts from the matched heading to the next heading
// of equal or higher level.

function extractSection(md, sectionName) {
  const lines = md.split("\n");
  const target = sectionName.toLowerCase().trim();
  let capturing = false;
  let captureLevel = 0;
  const result = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].toLowerCase().trim();
      if (!capturing && title.includes(target)) {
        capturing = true;
        captureLevel = level;
        result.push(line);
        continue;
      }
      if (capturing && level <= captureLevel) {
        break; // Next heading of equal or higher level — stop
      }
    }
    if (capturing) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n").trim() : null;
}

// ─── Index Parser ────────────────────────────────────────────────────────────
// Parses llms.txt into structured entries: { title, path, url }

function parseIndex(text) {
  const entries = [];
  const regex = /^- \[(.+?)\]\((.+?)\)$/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1];
    const url = match[2];
    // Extract path relative to base: https://filamentphp.com/docs/5.x/resources/overview.md → resources/overview
    const pathMatch = url.match(/\/docs\/5\.x\/(.+?)\.md$/);
    const path = pathMatch ? pathMatch[1] : url;
    entries.push({ title, path, url });
  }
  return entries;
}

// ─── Search Scorer ───────────────────────────────────────────────────────────

function scoreMatch(entry, query) {
  const q = query.toLowerCase();
  const title = entry.title.toLowerCase();
  const path = entry.path.toLowerCase();

  // Exact title match
  if (title === q) return 100;
  // Title starts with query
  if (title.startsWith(q)) return 80;
  // Title contains query
  if (title.includes(q)) return 60;
  // Path contains query
  if (path.includes(q)) return 40;
  // Partial word match in title
  const words = q.split(/\s+/);
  const matchCount = words.filter(
    (w) => title.includes(w) || path.includes(w)
  ).length;
  if (matchCount > 0) return 20 * (matchCount / words.length);

  return 0;
}

// ─── Best Practices Content (Filament v5 Accurate) ───────────────────────────

const BEST_PRACTICES = {
  architecture: `## Architecture
- Use separated Schema classes (CustomerForm.php) and Table classes (CustomersTable.php) — v5 generates these by default. Keep Resource classes lean.
- Move complex mutation logic into Model Observers or Service classes, not into form/table definitions.
- Use \`->components()\` for form schemas (replaces v4's \`->schema()\` on forms).
- Use \`->recordActions()\` for row-level table actions and \`->toolbarActions()\` for bulk/header actions.
- Use \`->schema()\` for action modal form content (NOT \`->form()\`).
- Prefer simple (modal) resources (\`--simple\`) for CRUD-only models that don't need separate pages.`,

  actions: `## Actions
- Prefer built-in Actions (CreateAction, EditAction, DeleteAction, ViewAction) over custom Livewire components.
- Use Action modals (\`->schema([...])\`) and slide-overs instead of creating custom pages or Blade views.
- Use the \`Heroicon\` enum for icons: \`->icon(Heroicon::PencilSquare)\` instead of string \`'heroicon-o-pencil-square'\`.
- Use \`->requiresConfirmation()\` for destructive actions.
- Use \`->fillForm(fn ($record) => $record)\` to pre-fill modal forms.`,

  database: `## Database & Queries
- Use \`modifyQueryUsing()\` on tables to eager-load relationships and prevent N+1.
- Use \`->searchable()\` and \`->sortable()\` only on indexed database columns.
- Rely on \`->relationship()\` for saving related data from forms instead of manual \`mutateFormDataBeforeSave\`.
- Override \`getEloquentQuery()\` for resource-wide query constraints (scopes, soft-deletes, tenancy).`,

  forms: `## Forms
- Use the \`Hidden\` component to pass contextual data instead of relying on global state.
- Use \`Operation::Create\` / \`Operation::Edit\` enum with \`->hiddenOn()\` / \`->visibleOn()\` for conditional fields.
- Use \`->relationship()\` on Select and other components for automatic relationship management.
- Prefer Filament's built-in validation rules over custom rule objects where possible.`,

  authorization: `## Authorization
- Rely strictly on Laravel Policies. Filament auto-maps: viewAny, create, update, view, delete, forceDelete, restore, reorder.
- Do NOT write manual auth checks in Resources — use Policy methods.
- Use \`$shouldSkipAuthorization = true\` only for development.
- Use \`->authorizeIndividualRecords()\` on bulk actions when per-record auth is needed.`,

  ui: `## UI & Styling
- Use Filament's theme config (Tailwind) and \`->extraAttributes()\` over raw CSS or custom Blade views.
- Use \`SubNavigationPosition::Top\` for tabbed navigation within resources.
- Use Section, Flex, Grid layout components for form organization.
- Use \`->grow(false)\` to prevent components from expanding.`,

  antiPatterns: `## Anti-Patterns to Avoid
- DON'T use \`->schema()\` on form definitions — use \`->components()\` (v5 change).
- DON'T use \`->actions()\` on tables — use \`->recordActions()\` or \`->toolbarActions()\` (v5 change).
- DON'T use string icon names — use the \`Heroicon\` enum.
- DON'T create custom Livewire components for CRUD — use Resources.
- DON'T put heavy logic in Resource classes — use Services/Observers.
- DON'T hardcode routes — use \`ResourceClass::getUrl()\`.
- DON'T define forms/tables inline in Resource if they're large — use the separated Schema/Table classes.`,
};

const ALL_TOPICS = Object.keys(BEST_PRACTICES);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_filament_docs",
      description:
        "Returns a compact index of ALL Filament v5 documentation pages with their paths. Call this FIRST to discover available pages before reading. Costs ~200 tokens.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              'Optional filter: "forms", "tables", "actions", "resources", "schemas", "infolists", "navigation", "widgets", "notifications", "plugins", "styling", "testing", "advanced", "introduction", "components". Returns all if omitted.',
          },
        },
      },
    },
    {
      name: "read_filament_docs",
      description:
        'Reads a Filament v5 documentation page. Use list_filament_docs first to find the correct path. Examples: "resources/overview", "forms/select", "tables/columns/text", "actions/modals".',
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'The doc page path (e.g., "resources/overview", "forms/select"). Required.',
          },
          section: {
            type: "string",
            description:
              'Optional heading name to extract only that section (e.g., "Authorization", "Creating a resource"). Drastically reduces tokens.',
          },
        },
        required: ["path"],
      },
    },
    {
      name: "search_filament_docs",
      description:
        'Searches Filament v5 docs by keyword. Returns matching page titles, paths, and optionally fetches the top result content. Use when you don\'t know the exact page path.',
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search query (e.g., "select filter", "authorization", "repeater", "soft delete").',
          },
          includeContent: {
            type: "boolean",
            description:
              "If true, fetches and returns the content of the top matching page. Default: false (returns only page list).",
          },
          maxResults: {
            type: "number",
            description: "Max number of matching pages to return. Default: 5.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "filament_best_practices",
      description:
        'Returns Filament v5 coding guidelines and anti-patterns. Topics: "architecture", "actions", "database", "forms", "authorization", "ui", "antiPatterns". Returns all if omitted.',
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: `Optional topic filter: ${ALL_TOPICS.map((t) => `"${t}"`).join(", ")}. Returns all topics if omitted.`,
          },
        },
      },
    },
  ],
}));

// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── list_filament_docs ──────────────────────────────────────────────────
  if (name === "list_filament_docs") {
    try {
      const raw = await fetchText(LLMS_TXT, INDEX_TTL);
      let entries = parseIndex(raw);

      const category = args?.category?.toLowerCase();
      if (category) {
        entries = entries.filter(
          (e) =>
            e.path.startsWith(category + "/") || e.path.startsWith(category)
        );
      }

      // Format as compact list: "path — Title"
      const lines = entries.map((e) => `${e.path} — ${e.title}`);
      const text = `# Filament v5 Documentation Index${category ? ` (${category})` : ""}\n${entries.length} pages available.\n\n${lines.join("\n")}`;

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch docs index: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // ── read_filament_docs ──────────────────────────────────────────────────
  if (name === "read_filament_docs") {
    const path = (args?.path || "").replace(/^\/+/, "").replace(/\.md$/, "");
    if (!path) {
      return {
        content: [
          {
            type: "text",
            text: 'Missing required "path" parameter. Use list_filament_docs to discover available paths.',
          },
        ],
        isError: true,
      };
    }

    const url = `${BASE}/${path}.md`;
    try {
      const raw = await fetchText(url);
      let content = cleanMarkdown(raw);

      // If a section filter is provided, extract only that section
      const section = args?.section;
      if (section) {
        const extracted = extractSection(content, section);
        if (extracted) {
          content = extracted;
        } else {
          content = `> Section "${section}" not found on this page.\n\n${content}`;
        }
      }

      return {
        content: [
          { type: "text", text: `Source: ${BASE}/${path}\n\n${content}` },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch: ${url}\n${error.message}\n\nUse list_filament_docs to find valid paths.`,
          },
        ],
        isError: true,
      };
    }
  }

  // ── search_filament_docs ────────────────────────────────────────────────
  if (name === "search_filament_docs") {
    const query = args?.query;
    if (!query) {
      return {
        content: [
          { type: "text", text: 'Missing required "query" parameter.' },
        ],
        isError: true,
      };
    }

    try {
      const raw = await fetchText(LLMS_TXT, INDEX_TTL);
      const entries = parseIndex(raw);
      const maxResults = args?.maxResults || 5;
      const includeContent = args?.includeContent || false;

      // Score and sort
      const scored = entries
        .map((e) => ({ ...e, score: scoreMatch(e, query) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      if (scored.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No documentation pages matched "${query}". Try broader terms or use list_filament_docs to browse.`,
            },
          ],
        };
      }

      let text = `# Search: "${query}"\n${scored.length} results:\n\n`;
      text += scored
        .map((e, i) => `${i + 1}. **${e.title}** — \`${e.path}\``)
        .join("\n");

      // Optionally fetch top result content
      if (includeContent && scored.length > 0) {
        const topUrl = `${BASE}/${scored[0].path}.md`;
        try {
          const raw = await fetchText(topUrl);
          const content = cleanMarkdown(raw);
          text += `\n\n---\n\n## ${scored[0].title}\n\n${content}`;
        } catch {
          text += `\n\n> Could not fetch content for top result.`;
        }
      }

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Search failed: ${error.message}` },
        ],
        isError: true,
      };
    }
  }

  // ── filament_best_practices ─────────────────────────────────────────────
  if (name === "filament_best_practices") {
    const topic = args?.topic?.toLowerCase();

    if (topic && BEST_PRACTICES[topic]) {
      return {
        content: [
          {
            type: "text",
            text: `# Filament v5 Best Practices — ${topic}\n\n${BEST_PRACTICES[topic]}`,
          },
        ],
      };
    }

    // Return all topics
    const all = Object.values(BEST_PRACTICES).join("\n\n");
    return {
      content: [
        { type: "text", text: `# Filament v5 Best Practices\n\n${all}` },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Filament v5 MCP Server v2.0.0 running (token-optimized)");
}

main();