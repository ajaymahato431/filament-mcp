/**
 * Server identity and configuration schema.
 *
 * Kept out of index.js so that tests and documentation checks can import it
 * without starting a server.
 */

export const NAME = "filament-mcp";
export const VERSION = "2.0.0";

const HOURS = 60 * 60 * 1000;

export const SCHEMA = {
  docsVersion: {
    flag: "docs-version",
    env: "FILAMENT_DOCS_VERSION",
    type: "string",
    default: "5.x",
    description: "Filament docs major version to serve",
  },
  requestTimeoutMs: {
    flag: "timeout",
    env: "REQUEST_TIMEOUT_MS",
    type: "number",
    default: 15000,
    description: "Per-request timeout in milliseconds",
  },
  retries: {
    flag: "retries",
    env: "REQUEST_RETRIES",
    type: "number",
    default: 2,
    description: "Retry attempts for transient upstream failures",
  },
  cacheMax: {
    flag: "cache-max",
    env: "CACHE_MAX_ENTRIES",
    type: "number",
    default: 100,
    description: "Maximum cached documents",
  },
  docTtlMs: {
    flag: "doc-ttl",
    env: "DOC_TTL_MS",
    type: "number",
    default: 3 * HOURS,
    description: "Cache lifetime for documentation pages",
  },
  indexTtlMs: {
    flag: "index-ttl",
    env: "INDEX_TTL_MS",
    type: "number",
    default: 6 * HOURS,
    description: "Cache lifetime for the documentation index",
  },
  negativeTtlMs: {
    flag: "negative-ttl",
    env: "NEGATIVE_TTL_MS",
    type: "number",
    default: 60 * 1000,
    description: "How long a failed fetch is remembered before retrying",
  },
  maxResults: {
    flag: "max-results",
    env: "SEARCH_MAX_RESULTS",
    type: "number",
    default: 5,
    description: "Default number of search results",
  },
};
