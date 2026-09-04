#!/usr/bin/env node
/**
 * filament-mcp — Model Context Protocol server for Filament documentation.
 *
 * Fetches, cleans and serves Filament docs to AI agents over stdio, with an
 * emphasis on returning the smallest useful slice of a page.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { bootstrap } from "./src/core/config.js";
import { createHttpClient } from "./src/core/http.js";
import { extractSection, renderOutline } from "./src/core/markdown.js";
import { searchEntries } from "./src/core/search.js";
import { runMain, serveStdio, textResult, errorResult, safeHandler } from "./src/core/runtime.js";
import {
  DOCS_ORIGIN,
  LLMS_TXT,
  cleanMarkdown,
  parseIndex,
  groupByCategory,
  filterByCategory,
} from "./src/filament.js";
import { ALL_TOPICS, renderBestPractices } from "./src/best-practices.js";
import { NAME, VERSION, SCHEMA } from "./src/settings.js";

const { config } = bootstrap({
  name: NAME,
  version: VERSION,
  description: "Serves Filament documentation to AI agents over the Model Context Protocol.",
  schema: SCHEMA,
  importMetaUrl: import.meta.url,
  examples: [`${NAME} --docs-version 4.x`, `${NAME} --timeout 30000 --cache-max 250`],
});

const BASE = `${DOCS_ORIGIN}/${config.docsVersion}`;

const http = createHttpClient({
  userAgent: `${NAME}/${VERSION} (+https://github.com/ajaymahato431/filament-mcp)`,
  timeoutMs: config.requestTimeoutMs,
  retries: config.retries,
  cacheMax: config.cacheMax,
  defaultTtl: config.docTtlMs,
  negativeTtl: config.negativeTtlMs,
});

/** The published index covers every Filament major version; keep only ours. */
async function loadIndex() {
  const raw = await http.fetchText(LLMS_TXT, { ttl: config.indexTtlMs });
  const entries = parseIndex(raw, { version: config.docsVersion });

  if (entries.length === 0) {
    throw new Error(
      `The documentation index contains no pages for version "${config.docsVersion}". ` +
        `Set FILAMENT_DOCS_VERSION to a published version such as 5.x or 4.x.`
    );
  }

  return entries;
}

async function readPage(path) {
  const raw = await http.fetchText(`${BASE}/${path}.md`, { ttl: config.docTtlMs });
  return cleanMarkdown(raw);
}

const server = new McpServer({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const NETWORK_HINT = "Check network access to filamentphp.com, then try again.";

// ─── list_filament_docs ──────────────────────────────────────────────────────

server.registerTool(
  "list_filament_docs",
  {
    title: "List Filament documentation pages",
    description:
      "Browses the Filament documentation index. Called with no arguments it returns a " +
      "category summary (~100 tokens) — start here. Pass `category` to list the pages in one " +
      'category (~100-400 tokens). Pass `category: "all"` to list every page (~4000 tokens; ' +
      "prefer search_filament_docs instead).",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe(
          'Category to list, e.g. "forms", "tables", "resources", "actions". ' +
            'Use "all" for every page. Omit for the category summary.'
        ),
      limit: z.number().int().positive().max(500).optional().describe("Maximum pages to return."),
      offset: z.number().int().min(0).optional().describe("Pages to skip, for paging."),
    },
    annotations: READ_ONLY,
  },
  safeHandler(async ({ category, limit, offset = 0 }) => {
    const entries = await loadIndex();

    // Default view: a compact map of the documentation, not the whole thing.
    if (!category) {
      const groups = groupByCategory(entries);
      const rows = groups.map((g) => `  ${g.category} — ${g.count} pages`).join("\n");
      return textResult(
        `# Filament ${config.docsVersion} documentation\n` +
          `${entries.length} pages across ${groups.length} categories.\n\n${rows}\n\n` +
          `Next: call again with a category, or use search_filament_docs to find a page directly.`
      );
    }

    const wantsAll = String(category).toLowerCase() === "all";
    const selected = wantsAll ? entries : filterByCategory(entries, category);

    if (selected.length === 0) {
      const available = groupByCategory(entries)
        .map((g) => g.category)
        .join(", ");
      return errorResult(
        `No category "${category}" in the Filament ${config.docsVersion} docs.\n` +
          `Available categories: ${available}`
      );
    }

    const page = selected.slice(offset, offset + (limit ?? selected.length));
    const more =
      offset + page.length < selected.length
        ? `\n\nMore available: call again with offset ${offset + page.length}.`
        : "";

    return textResult(
      `# Filament ${config.docsVersion} — ${wantsAll ? "all pages" : category}\n` +
        `Showing ${page.length} of ${selected.length}\n\n` +
        `${page.map((e) => `${e.path} — ${e.title}`).join("\n")}${more}`
    );
  }, NETWORK_HINT)
);

// ─── read_filament_docs ──────────────────────────────────────────────────────

server.registerTool(
  "read_filament_docs",
  {
    title: "Read a Filament documentation page",
    description:
      "Reads one Filament documentation page. Use `section` to extract a single heading " +
      "instead of the whole page — most pages are far larger than the part you need. Find " +
      'paths with list_filament_docs or search_filament_docs. Examples: "resources/overview", ' +
      '"forms/select", "tables/columns/text".',
    inputSchema: {
      path: z.string().min(1).describe('Doc page path, e.g. "forms/select". Required.'),
      section: z
        .string()
        .optional()
        .describe('Heading to extract, e.g. "Authorization". Greatly reduces output size.'),
      outline: z
        .boolean()
        .optional()
        .describe("Return only the page's heading outline, to choose a section cheaply."),
    },
    annotations: READ_ONLY,
  },
  safeHandler(async ({ path, section, outline }) => {
    const clean = path.replace(/^\/+/, "").replace(/\.md$/, "");
    if (!clean) return errorResult('The "path" parameter cannot be empty.');

    let content;
    try {
      content = await readPage(clean);
    } catch (error) {
      if (error?.status === 404) {
        return errorResult(
          `No such page: ${clean}\n` +
            `That path does not exist in the Filament ${config.docsVersion} docs. ` +
            `Use search_filament_docs to find the right one.`
        );
      }
      throw error;
    }

    if (outline) {
      return textResult(`# Outline — ${clean}\n\n${renderOutline(content)}`);
    }

    if (section) {
      const extracted = extractSection(content, section);
      if (extracted) return textResult(`Source: ${BASE}/${clean}\n\n${extracted}`);

      // Returning the whole page here would be the opposite of what was asked;
      // the outline lets the caller retry precisely and cheaply.
      return textResult(
        `Section "${section}" was not found on ${clean}. Available headings:\n\n` +
          `${renderOutline(content)}\n\n` +
          `Re-read with one of these, or omit "section" for the full page.`
      );
    }

    return textResult(`Source: ${BASE}/${clean}\n\n${content}`);
  }, NETWORK_HINT)
);

// ─── search_filament_docs ────────────────────────────────────────────────────

server.registerTool(
  "search_filament_docs",
  {
    title: "Search the Filament documentation",
    description:
      "Finds Filament documentation pages by keyword, returning ranked titles and paths. " +
      "Use this when you do not already know the exact page path.",
    inputSchema: {
      query: z.string().min(1).describe('Search terms, e.g. "select filter", "soft delete".'),
      includeContent: z
        .boolean()
        .optional()
        .describe("Also return the full content of the top result. Default false."),
      maxResults: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe("Result count. Default 5."),
    },
    annotations: READ_ONLY,
  },
  safeHandler(async ({ query, includeContent = false, maxResults }) => {
    const entries = await loadIndex();
    const results = searchEntries(entries, query, { limit: maxResults ?? config.maxResults });

    if (results.length === 0) {
      const categories = groupByCategory(entries)
        .map((g) => g.category)
        .join(", ");
      return textResult(
        `No Filament ${config.docsVersion} pages matched "${query}".\n` +
          `Try broader terms, or browse a category: ${categories}`
      );
    }

    let text =
      `# Search: "${query}"\n${results.length} result${results.length === 1 ? "" : "s"}:\n\n` +
      results.map((e, i) => `${i + 1}. **${e.title}** — \`${e.path}\``).join("\n");

    if (includeContent) {
      try {
        text += `\n\n---\n\n## ${results[0].title}\n\n${await readPage(results[0].path)}`;
      } catch {
        text += `\n\n> Could not fetch the top result; read it directly with read_filament_docs.`;
      }
    }

    return textResult(text);
  }, NETWORK_HINT)
);

// ─── filament_best_practices ─────────────────────────────────────────────────

server.registerTool(
  "filament_best_practices",
  {
    title: "Filament best practices",
    description:
      "Returns curated Filament v5 coding guidelines and anti-patterns. Answers instantly " +
      "with no network access. Read this before writing or refactoring Filament code.",
    inputSchema: {
      topic: z.enum(ALL_TOPICS).optional().describe("Single topic to return. Omit for all topics."),
    },
    annotations: { ...READ_ONLY, openWorldHint: false },
  },
  safeHandler(async ({ topic }) => textResult(renderBestPractices(topic)))
);

// ─── Start ───────────────────────────────────────────────────────────────────

runMain(async () => {
  await serveStdio(server, { name: NAME, version: VERSION });
});
