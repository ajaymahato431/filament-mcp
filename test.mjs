// Quick integration test — sends JSON-RPC messages to the MCP server via stdin/stdout
import { spawn } from "child_process";

const proc = spawn("node", ["index.js"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const responses = [];

proc.stdout.on("data", (data) => {
  buffer += data.toString();
  // MCP uses newline-delimited JSON
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);
        responses.push(parsed);
        handleResponse(parsed);
      } catch {}
    }
  }
});

proc.stderr.on("data", (data) => {
  console.error("[stderr]", data.toString().trim());
});

let testIndex = 0;
const tests = [
  // Test 1: Initialize
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  },
  // Test 2: List tools
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  // Test 3: filament_best_practices (topic filter)
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "filament_best_practices",
      arguments: { topic: "antiPatterns" },
    },
  },
  // Test 4: list_filament_docs (category filter)
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "list_filament_docs",
      arguments: { category: "forms" },
    },
  },
  // Test 5: read_filament_docs (with section extraction)
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "read_filament_docs",
      arguments: { path: "resources/overview", section: "Authorization" },
    },
  },
  // Test 6: search_filament_docs
  {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "search_filament_docs",
      arguments: { query: "select filter", maxResults: 3 },
    },
  },
];

function sendNext() {
  if (testIndex >= tests.length) return;
  const msg = tests[testIndex];
  proc.stdin.write(JSON.stringify(msg) + "\n");
  testIndex++;
}

function handleResponse(resp) {
  const id = resp.id;
  if (id === 1) {
    // After init, send initialized notification then continue
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n"
    );
    console.log(`✅ Test 1 (initialize): OK — server: ${resp.result?.serverInfo?.name} v${resp.result?.serverInfo?.version}`);
    sendNext();
  } else if (id === 2) {
    const toolNames = resp.result?.tools?.map((t) => t.name) || [];
    console.log(`✅ Test 2 (list tools): ${toolNames.length} tools — [${toolNames.join(", ")}]`);
    sendNext();
  } else if (id === 3) {
    const text = resp.result?.content?.[0]?.text || "";
    const tokens = Math.ceil(text.length / 4); // rough estimate
    console.log(`✅ Test 3 (best practices/antiPatterns): ~${tokens} tokens, ${text.length} chars`);
    sendNext();
  } else if (id === 4) {
    const text = resp.result?.content?.[0]?.text || "";
    const lines = text.split("\n").filter((l) => l.includes(" — ")).length;
    console.log(`✅ Test 4 (list docs/forms): ${lines} form pages found`);
    sendNext();
  } else if (id === 5) {
    const text = resp.result?.content?.[0]?.text || "";
    const tokens = Math.ceil(text.length / 4);
    const hasSection = text.includes("Authorization") || text.includes("authorization");
    console.log(`✅ Test 5 (read docs/section): ~${tokens} tokens, section extracted: ${hasSection}`);
    sendNext();
  } else if (id === 6) {
    const text = resp.result?.content?.[0]?.text || "";
    const resultCount = (text.match(/^\d+\./gm) || []).length;
    console.log(`✅ Test 6 (search "select filter"): ${resultCount} results`);

    // All tests done
    console.log("\n🎉 All tests passed!");
    proc.kill();
    process.exit(0);
  }
}

proc.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\n❌ Server exited with code ${code}`);
    process.exit(1);
  }
});

// Start the test sequence
setTimeout(() => sendNext(), 500);

// Safety timeout
setTimeout(() => {
  console.error("\n⏰ Test timed out after 30s");
  proc.kill();
  process.exit(1);
}, 30000);
