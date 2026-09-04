/**
 * Unit tests for the Filament-specific index parsing and markdown cleanup.
 * Offline — safe to run in CI.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanMarkdown,
  parseIndex,
  categoryOf,
  groupByCategory,
  filterByCategory,
} from "../src/filament.js";
import { repoRoot } from "./helpers/client.mjs";

const ROOT = repoRoot(import.meta.url);
const FIXTURE = readFileSync(join(ROOT, "test", "fixtures", "llms-sample.txt"), "utf8");

// ─── index parsing ───────────────────────────────────────────────────────────

test("parseIndex returns only the requested major version", () => {
  const entries = parseIndex(FIXTURE, { version: "5.x" });

  assert.equal(entries.length, 7);
  assert.ok(
    entries.every((e) => e.version === "5.x"),
    "the published llms.txt covers 1.x-5.x; serving another version would be wrong"
  );
  assert.deepEqual(
    entries.map((e) => e.path).slice(0, 3),
    ["introduction/overview", "introduction/installation", "getting-started"]
  );
});

test("parseIndex can target an older version", () => {
  const entries = parseIndex(FIXTURE, { version: "4.x" });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.version === "4.x"));
});

test("parseIndex never yields a bare URL as a path", () => {
  // The v1 parser fell back to `path = url` for any non-5.x entry, which then
  // produced nonsense fetches like `<base>/https://.../overview.md.md`.
  for (const version of ["5.x", "4.x", "3.x", "2.x", "1.x"]) {
    for (const entry of parseIndex(FIXTURE, { version })) {
      assert.doesNotMatch(entry.path, /^https?:/, `bad path for ${version}: ${entry.path}`);
    }
  }
});

test("parseIndex drops links that are not versioned doc pages", () => {
  const all = ["5.x", "4.x", "3.x", "2.x", "1.x"].flatMap((version) =>
    parseIndex(FIXTURE, { version })
  );
  assert.equal(all.length, 12, "the blog link should not appear in any version");
  assert.ok(!all.some((e) => e.title === "Not a doc link"));
});

test("parseIndex with no version returns every entry it can parse", () => {
  assert.equal(parseIndex(FIXTURE).length, 12);
});

// ─── categories ──────────────────────────────────────────────────────────────

test("categoryOf uses the top-level path segment", () => {
  assert.equal(categoryOf("tables/columns/text"), "tables");
  assert.equal(categoryOf("forms/select"), "forms");
  assert.equal(categoryOf("getting-started"), "(top-level)");
});

test("groupByCategory counts pages per category, largest first", () => {
  const groups = groupByCategory(parseIndex(FIXTURE, { version: "5.x" }));
  const counts = Object.fromEntries(groups.map((g) => [g.category, g.count]));

  assert.equal(counts.introduction, 2);
  assert.equal(counts.resources, 2);
  assert.equal(counts.forms, 1);
  assert.equal(counts["(top-level)"], 1);
  assert.ok(groups[0].count >= groups.at(-1).count, "groups must be sorted by size");
});

test("filterByCategory matches whole segments, not prefixes", () => {
  const entries = [
    { title: "Select", path: "forms/select" },
    { title: "Overview", path: "form-builder/overview" },
  ];
  const filtered = filterByCategory(entries, "form");

  assert.equal(filtered.length, 0, '"form" must not match the "forms" or "form-builder" categories');
  assert.equal(filterByCategory(entries, "forms").length, 1);
});

test("filterByCategory is case- and slash-insensitive", () => {
  const entries = parseIndex(FIXTURE, { version: "5.x" });
  assert.equal(filterByCategory(entries, "Forms").length, 1);
  assert.equal(filterByCategory(entries, "/forms/").length, 1);
});

// ─── markdown cleanup ────────────────────────────────────────────────────────

test("cleanMarkdown converts multi-line Mintlify admonitions to blockquotes", () => {
  const out = cleanMarkdown("<Tip>\nUse the enum.\nIt is safer.\n</Tip>");
  assert.match(out, /> \*\*Tip:\*\* Use the enum\./);
  assert.doesNotMatch(out, /<Tip>/, "the JSX tag must not survive");
});

test("cleanMarkdown handles every admonition type", () => {
  for (const tag of ["Tip", "Warning", "Danger", "Note", "Info"]) {
    const out = cleanMarkdown(`<${tag}>content</${tag}>`);
    assert.match(out, new RegExp(`\\*\\*${tag}:\\*\\* content`));
  }
});

test("cleanMarkdown strips imports, screenshots, images and HTML comments", () => {
  const input = [
    "import { AutoScreenshot } from '@site/components';",
    "<!-- an html comment -->",
    "# Title",
    "<AutoScreenshot name='forms/select' alt='Select' version='5.x' />",
    "![a screenshot](https://example.com/shot.png)",
    "<EditOnGitHub file='forms/select.md' />",
    "<Footer />",
    "Real content.",
  ].join("\n");

  const out = cleanMarkdown(input);

  assert.match(out, /# Title/);
  assert.match(out, /Real content\./);
  for (const noise of ["import {", "AutoScreenshot", "EditOnGitHub", "Footer", "html comment", "shot.png"]) {
    assert.ok(!out.includes(noise), `"${noise}" should have been stripped`);
  }
});

test("cleanMarkdown strips theme metadata but keeps the code fence language", () => {
  const out = cleanMarkdown('```php theme={"theme":"gruvbox-dark-hard"}\n$x = 1;\n```');
  assert.match(out, /```php\n/);
  assert.doesNotMatch(out, /theme=/);
});

test("cleanMarkdown collapses runs of blank lines", () => {
  assert.equal(cleanMarkdown("a\n\n\n\n\nb"), "a\n\nb");
});
