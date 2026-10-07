# Installing Zephira MCP

Prerequisites: an active production Zephira dashboard MCP key beginning `zph_live_`; the scopes needed for the chosen tools; Node.js 22+ for the stdio bridge.

For clients supporting remote Streamable HTTP, use `https://dashboard.zephira.ai/api/mcp` with `Authorization: Bearer <your dashboard MCP key>`. Store the key privately in the client's credential settings. This endpoint does not use API v2 Token credentials or OAuth.

For stdio clients, configure the command as `npx` with arguments `-y` and `github:sens663/zephira-mcp`; put the active dashboard MCP key in the private `ZEPHIRA_API_KEY` environment field. Alternatively clone this repository and run its `bin/zephira-mcp.mjs` with Node.js.

For Gemini CLI, run `gemini extensions install https://github.com/sens663/zephira-mcp` and supply the key through the sensitive extension setting.

Verify that `tools/list` exposes `search_entities`, `get_entity`, `get_officers`, `get_shareholders`, `get_corporate_hierarchy` and `get_financials`. Discovery does not consume data credits. Use `search_entities` with a known jurisdiction and a name or identifier only when the user requests a company lookup; subsequent data calls use the user's allowance. Preserve returned provenance and coverage limitations.

Documentation: https://zephira.ai/developers/mcp/. Support: support@zephira.ai.
