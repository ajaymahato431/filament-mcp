/**
 * Filament-specific documentation handling: index parsing, category grouping,
 * and Mintlify markdown cleanup.
 */

import { collapseBlankLines, stripHtmlComments } from "./core/markdown.js";

export const DOCS_ORIGIN = "https://filamentphp.com/docs";
export const LLMS_TXT = `${DOCS_ORIGIN}/llms.txt`;

/**
 * Strips Mintlify JSX components, screenshot tags, sponsor blocks and code-fence
 * theme metadata — none of which carry meaning for an agent, all of which cost tokens.
 */
export function cleanMarkdown(md) {
  let out = stripHtmlComments(md);

  // JSX imports and component definitions (multi-line, terminated by `};`).
  out = out.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "");
  out = out.replace(/^export const \w+[\s\S]*?^};$/gm, "");

  // Component invocations that render images or chrome.
  out = out.replace(/<AutoScreenshot[^>]*\/>/g, "");
  out = out.replace(/<EditOnGitHub[^>]*\/>/g, "");
  out = out.replace(/<Footer\s*\/>/g, "");

  // Mintlify admonitions become plain markdown blockquotes. A single literal
  // regex avoids the escaping hazards of building one per tag with `new RegExp`.
  out = out.replace(
    /<(Tip|Warning|Danger|Note|Info)>([\s\S]*?)<\/\1>/g,
    (_, tag, content) => `> **${tag}:** ${content.trim()}`
  );

  // ```php theme={"theme":"gruvbox-dark-hard"}  ->  ```php
  out = out.replace(/```(\w+)\s+theme=\{[^}]*\}/g, "```$1");

  // Screenshots are noise for a text-only consumer.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  return collapseBlankLines(out).trim();
}

/**
 * Parses `llms.txt` into `{ title, path, url, version }` entries.
 *
 * Filament publishes a single `llms.txt` covering *every* major version — 1.x
 * through 5.x in one file. Entries must therefore be filtered by version, or the
 * server will happily serve v3 documentation while claiming to be a v5 server.
 * Anything whose URL does not parse into a version and a path is dropped rather
 * than passed through as a bare URL, which is not a usable doc path.
 */
export function parseIndex(text, { version } = {}) {
  const entries = [];
  const regex = /^- \[(.+?)\]\((.+?)\)$/gm;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [, title, url] = match;
    const parsed = url.match(/\/docs\/(\d+\.x)\/(.+?)\.md$/);
    if (!parsed) continue;

    const [, entryVersion, path] = parsed;
    if (version && entryVersion !== version) continue;

    entries.push({ title, path, url, version: entryVersion });
  }

  return entries;
}

/** Top-level path segment, e.g. `tables/columns/text` -> `tables`. */
export function categoryOf(path) {
  return path.includes("/") ? path.split("/")[0] : "(top-level)";
}

/** `{ category, count }` rows in descending size order. */
export function groupByCategory(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const category = categoryOf(entry.path);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

/** Exact top-level category match — a loose `startsWith` conflates `form` and `forms`. */
export function filterByCategory(entries, category) {
  const target = String(category).toLowerCase().trim().replace(/^\/+|\/+$/g, "");
  return entries.filter((entry) => categoryOf(entry.path).toLowerCase() === target);
}
