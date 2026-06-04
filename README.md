# Filament v5 Docs MCP Server

A token-optimized Model Context Protocol (MCP) server for retrieving and searching Filament v5 documentation. This tool provides AI agents with up-to-date, accurate context regarding Filament v5 to help assist you in developing modern Laravel applications.

## Features

This MCP server provides the following tools to the AI:
- **`list_filament_docs`**: Lists all available Filament v5 documentation sections and pages.
- **`read_filament_docs`**: Reads the detailed content of a specific Filament v5 documentation page.
- **`search_filament_docs`**: Performs a keyword search across the Filament documentation to find relevant topics.
- **`filament_best_practices`**: Provides token-optimized summaries of best practices for building applications with Filament v5.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)

## Installation

1. Clone or download this repository.
2. Navigate to the project directory:
   ```bash
   cd /path/to/filament-mcp
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Verify it runs:
   ```bash
   npm start
   ```

## Complete Use Case Instructions

### 1. The Problem
When asking an AI agent (like Antigravity, Cline, or Roo) to help you build a Filament v5 panel, form, or table, the AI might hallucinate older version syntax (v2 or v3) or lack context on new v5 features.

### 2. The Solution
By integrating this MCP server, the AI can query the most recent Filament v5 documentation in real-time, search for specific components, read detailed guides, and provide you with accurate, up-to-date code snippets.

### 3. Integrate into Your IDE

You can now connect this specific tool to your IDE using the same method as before.

**For Antigravity:**
Edit `~/.gemini/config/mcp_config.json`

**For VS Code (Cline/Roo):**
Edit your `cline_mcp_settings.json`

Add the following block to your configuration file, ensuring you use the absolute path to where you saved the `filament-mcp` folder:

```json
{
  "mcpServers": {
    "filament-v5-docs": {
      "command": "node",
      "args": [
        "/absolute/path/to/your/filament-mcp/index.js"
      ]
    }
  }
}
```

### How the AI will use this

Once configured, simply instruct your AI assistant. For example:
- *"I need to build a Filament v5 relation manager for a User resource, but I'm not sure of the exact syntax. Can you search the Filament v5 docs for 'relation manager'?"*
- *"Can you list the Filament best practices before we refactor my Dashboard page?"*
- *"Read the Filament documentation page on 'Forms - Layout' and then help me build a 2-column form."*

The AI will automatically invoke the tools (`search_filament_docs`, `read_filament_docs`, etc.) to retrieve the required context before generating its response.
