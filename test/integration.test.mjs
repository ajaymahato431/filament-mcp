/**
 * End-to-end tests: spawns the real server and talks JSON-RPC over stdio
 * against live filamentphp.com documentation.
 *
 * Network-dependent, so excluded from `npm test`. Run with `npm run test:integration`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { startServer, repoRoot } from "./helpers/client.mjs";
import { NAME, VERSION } from "../src/settings.js";

const ROOT = repoRoot(import.meta.url);

async function withServer(fn, env = {}) {
  const client = await startServer({ cwd: ROOT, env });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test("server initializes and reports its identity", async () => {
  await withServer(async (client) => {
    assert.equal(client.serverInfo.name, NAME);
    assert.equal(client.serverInfo.version, VERSION);
  });
});

test("all four tools are advertised with input schemas and read-only hints", async () => {
  await withServer(async (client) => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    assert.deepEqual(names, [
      "filament_best_practices",
      "list_filament_docs",
      "read_filament_docs",
      "search_filament_docs",
    ]);

    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} needs a description`);
      assert.equal(tool.inputSchema?.type, "object", `${tool.name} needs an object input schema`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} should be read-only`);
    }
  });
});

test("list_filament_docs with no arguments returns a small category summary", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("list_filament_docs");
    assert.equal(isError, false);

    // Regression guard for the v1 defect: the tool advertised "~200 tokens" while
    // actually returning the entire 557-entry index — 36,388 characters (~9,100
    // tokens). The summary must stay genuinely cheap, or the description is a lie.
    assert.ok(
      text.length < 2000,
      `the default listing must stay compact, got ${text.length} chars (~${Math.ceil(text.length / 4)} tokens)`
    );

    assert.match(text, /categories/);
    assert.match(text, /forms — \d+ pages/);
    assert.match(text, /tables — \d+ pages/);
  });
});

test("the default listing counts only the configured major version", async () => {
  await withServer(async (client) => {
    const { text } = await client.call("list_filament_docs");
    const total = Number(text.match(/^(\d+) pages across/m)?.[1]);

    // 5.x has ~161 pages; the full multi-version file has 557. A count in the
    // 500s would mean v1-v4 pages had leaked back into the v5 index.
    assert.ok(Number.isFinite(total), "the summary should state a page total");
    assert.ok(total > 50 && total < 350, `expected a single-version page count, got ${total}`);
  });
});

test("a category listing returns usable relative paths, never URLs", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("list_filament_docs", { category: "forms" });
    assert.equal(isError, false);

    const paths = [...text.matchAll(/^(\S+) — /gm)].map((m) => m[1]);
    assert.ok(paths.length > 5, "the forms category should list several pages");
    for (const path of paths) {
      assert.doesNotMatch(path, /^https?:/, `"${path}" is a URL, not a doc path`);
      assert.match(path, /^forms\//);
    }
  });
});

test("an unknown category reports the available ones instead of failing silently", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("list_filament_docs", { category: "nonsense" });
    assert.equal(isError, true);
    assert.match(text, /Available categories/);
  });
});

test("read_filament_docs returns cleaned page content", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("read_filament_docs", {
      path: "resources/overview",
    });

    assert.equal(isError, false);
    assert.match(text, /Source: https:\/\/filamentphp\.com\/docs\/5\.x\/resources\/overview/);
    assert.ok(text.length > 500, "the overview page should have substantial content");
    assert.ok(!text.includes("<AutoScreenshot"), "JSX components should be stripped");
    assert.ok(!text.includes("theme={"), "code-fence theme metadata should be stripped");
  });
});

test("section extraction returns far less than the full page", async () => {
  await withServer(async (client) => {
    const full = await client.call("read_filament_docs", { path: "resources/overview" });
    const section = await client.call("read_filament_docs", {
      path: "resources/overview",
      section: "Authorization",
    });

    assert.equal(section.isError, false);
    assert.ok(
      section.text.length < full.text.length,
      "extracting one section must be cheaper than the whole page"
    );
    assert.match(section.text, /[Aa]uthorization/);
  });
});

test("a missing section returns the page outline rather than the whole page", async () => {
  await withServer(async (client) => {
    const full = await client.call("read_filament_docs", { path: "resources/overview" });
    const { text } = await client.call("read_filament_docs", {
      path: "resources/overview",
      section: "This Heading Does Not Exist",
    });

    assert.match(text, /was not found/);
    assert.match(text, /Available headings/);
    assert.ok(
      text.length < full.text.length,
      "the fallback must not dump the entire page the caller declined to ask for"
    );
  });
});

test("outline mode is cheap and lists headings", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("read_filament_docs", {
      path: "resources/overview",
      outline: true,
    });

    assert.equal(isError, false);
    assert.match(text, /# Outline/);
    assert.ok(text.length < 3000, `outline should be compact, got ${text.length} chars`);
  });
});

test("an unknown page path returns a helpful error, not a crash", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("read_filament_docs", {
      path: "does/not/exist/anywhere",
    });

    assert.equal(isError, true);
    assert.match(text, /search_filament_docs/);
  });
});

test("search returns ranked results with relative paths", async () => {
  await withServer(async (client) => {
    const { text, isError } = await client.call("search_filament_docs", {
      query: "select filter",
      maxResults: 3,
    });

    assert.equal(isError, false);
    const paths = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(paths.length > 0, "search should return at least one result");
    for (const path of paths) {
      assert.doesNotMatch(path, /^https?:/, `search returned a URL instead of a path: ${path}`);
    }
  });
});

test("search with includeContent fetches the top result successfully", async () => {
  await withServer(async (client) => {
    const { text } = await client.call("search_filament_docs", {
      query: "select",
      maxResults: 1,
      includeContent: true,
    });

    assert.ok(
      !text.includes("Could not fetch the top result"),
      "the top search result must resolve to a fetchable page"
    );
    assert.match(text, /---/);
  });
});

test("best practices answers offline and honours the topic filter", async () => {
  await withServer(async (client) => {
    const all = await client.call("filament_best_practices");
    assert.match(all.text, /Anti-Patterns/);

    const one = await client.call("filament_best_practices", { topic: "antiPatterns" });
    assert.match(one.text, /antiPatterns/);
    assert.ok(one.text.length < all.text.length, "a single topic should be smaller than all topics");
  });
});

test("invalid arguments are rejected by schema validation", async () => {
  await withServer(async (client) => {
    const response = await client.callRaw("read_filament_docs", {});
    const failed = Boolean(response.error) || response.result?.isError === true;
    assert.ok(failed, "omitting the required path must not succeed");
  });
});

test("a bad docs version fails with an actionable message", async () => {
  await withServer(
    async (client) => {
      const { text, isError } = await client.call("list_filament_docs");
      assert.equal(isError, true);
      assert.match(text, /FILAMENT_DOCS_VERSION/);
    },
    { FILAMENT_DOCS_VERSION: "99.x" }
  );
});
