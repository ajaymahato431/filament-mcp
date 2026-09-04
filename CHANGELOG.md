# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] — 2026-09-04

The first public release. This version fixes two defects that caused the server
to misinform the agents it was meant to help.

### Fixed

- **The index no longer serves the wrong Filament version.** Upstream publishes a
  single `llms.txt` covering Filament 1.x through 5.x — 557 entries, of which only
  161 are 5.x. The previous parser kept all of them, and for the 396 non-5.x entries
  it stored the full URL where a page path belonged. `search_filament_docs` could
  therefore rank a v3 page first, and reading it produced a doubled URL
  (`.../5.x/https://.../3.x/....md`) that always 404'd. Entries are now parsed with
  their version and filtered to the configured one.
- **`list_filament_docs` now costs what it claims.** It advertised "~200 tokens"
  while returning the entire index: 36,388 characters, roughly 9,100 tokens. The
  default call now returns a category summary of about 130 tokens. An integration
  test asserts the ceiling so the description cannot drift from reality again.
- **Requests can no longer hang forever.** Every fetch has a timeout (default 15s)
  and retries transient failures with exponential backoff, honouring `Retry-After`.
- **Multi-line `<Tip>`, `<Warning>`, `<Danger>`, `<Note>` and `<Info>` blocks are
  converted properly.** A regex-escaping bug meant only single-line admonitions
  were matched; the rest were passed through as raw JSX.
- **Section extraction picks the right heading.** Matching was a plain substring
  test, so asking for "Fields" could return "Fields in forms" if that heading came
  first. Matches are now ranked exact, then prefix, then substring.
- **A failed startup is now reported.** `main()` was never `.catch()`-ed, so any
  startup error surfaced as a silent unhandled rejection.
- **Category filtering matches whole segments.** `category: "form"` no longer
  matches the `forms` category.
- Failed fetches are cached briefly, so a missing page is not re-requested on
  every call.
- Concurrent requests for the same URL now share a single upstream fetch.

### Added

- `search_filament_docs` and `list_filament_docs` accept `limit`/`offset` paging.
- `read_filament_docs` gains `outline: true`, returning just the page's headings
  so a section can be chosen cheaply.
- When a requested `section` does not exist, the response lists the available
  headings instead of dumping the whole page.
- Full configuration through CLI flags and environment variables, with
  `.env` support and documented precedence: flag > environment > default.
  See [`.env.example`](.env.example).
- `--help` and `--version`.
- `FILAMENT_DOCS_VERSION` to target a version other than 5.x.
- Published to npm with a `bin` entry, so the server runs via
  `npx -y filament-mcp` with no absolute paths in your MCP configuration.
- A real test suite: 45 offline unit tests and 16 live integration tests,
  replacing a harness that printed "All tests passed" unconditionally.
- CI across Node 20/22/24 on Linux, macOS and Windows.
- `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.

### Changed

- **Breaking:** `list_filament_docs` with no arguments returns a category summary
  rather than every page. Pass a `category`, or `category: "all"` for the previous
  behaviour (now correctly limited to one version).
- **Breaking:** requires Node.js 20 or later.
- Migrated to the SDK's `McpServer` / `registerTool` API. Tool arguments are now
  validated, and tools are annotated as read-only.
- Tools report accurate token costs in their descriptions.
- Internals split into `src/core/` (shared with the sibling servers) and
  `src/filament.js`.
- License corrected from `ISC` (declared in `package.json` with no licence file)
  to MIT, with a `LICENSE` file.

## [1.0.0]

- Initial version: `list_filament_docs`, `read_filament_docs`,
  `search_filament_docs`, `filament_best_practices`.

[Unreleased]: https://github.com/ajaymahato431/filament-mcp/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/ajaymahato431/filament-mcp/releases/tag/v2.0.0
[1.0.0]: https://github.com/ajaymahato431/filament-mcp/releases/tag/v1.0.0
