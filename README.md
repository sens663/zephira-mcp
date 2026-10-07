# Zephira Company Intelligence MCP

Connect AI assistants to company records, officers, ownership, corporate group structures and available financial statements through six read-only tools. Responses preserve available source provenance. Coverage varies by company and jurisdiction.

This repository contains client configurations, a Gemini CLI extension and an open-source stdio bridge. The hosted Zephira service and company data remain governed by Zephira's service terms; the MIT license applies to this repository's client code and documentation.

## Hosted connection

- **Endpoint:** `https://dashboard.zephira.ai/api/mcp`
- **Transport:** Streamable HTTP
- **Authentication:** `Authorization: Bearer <your active production dashboard API key>`
- **Key prefix:** `zph_live_`
- **Setup:** https://zephira.ai/developers/mcp/
- **Official MCP Registry name:** `ai.zephira.dashboard/company-intelligence`
- **Public discovery:** https://dashboard.zephira.ai/.well-known/mcp/server-card.json

Create your own dashboard key at https://dashboard.zephira.ai/. API v2 Token credentials are separate from MCP dashboard Bearer keys. Keep keys in your client's secret settings or environment; do not commit them or add them to URLs. The endpoint currently uses an API key, not OAuth.

Company data calls use your dashboard allowance. Discovery and tool listing do not consume data credits.

## Tools

| Tool | Purpose | Required scope |
| --- | --- | --- |
| `search_entities` | Find companies by location plus name, registration number, VAT number or ticker | `company:read` |
| `get_entity` | Retrieve company identity and available profile fields | `company:read` |
| `get_officers` | Retrieve a page of company officers | `company:read` |
| `get_shareholders` | Retrieve a page of shareholders | `ownership:read` |
| `get_corporate_hierarchy` | Retrieve available group structure while preserving source/modelled labels | `ownership:read` |
| `get_financials` | Retrieve available financial statements and source metadata | `financials:read` |

`search_entities` requires `location` and at least one supported name/identifier. Pass numeric company IDs returned by search as strings to the other tools. Officers and shareholders support pagination. The public `metadata/server-card.json` snapshot includes full input schemas and read-only annotations; the hosted endpoint remains authoritative.

## Gemini CLI extension

Requires Node.js 22 or later, Git and Gemini CLI.

```sh
gemini extensions install https://github.com/sens663/zephira-mcp
```

Enter your dashboard MCP key when the extension asks for it. The setting is marked sensitive. The extension runs the included stdio bridge, which sends MCP requests to Zephira's hosted endpoint. No npm dependencies or build step are required.

## Clients with native remote MCP

Use the hosted URL and Bearer header directly in clients that support Streamable HTTP and custom authentication headers. Configure the API key using the client's secret fields. See `configs/remote.example.json` for the connection shape; replace the placeholder only in private client settings.

## Clients requiring stdio

Requires Node.js 22 or later and an active dashboard MCP key.

```sh
git clone https://github.com/sens663/zephira-mcp.git
cd zephira-mcp
```

Set `ZEPHIRA_API_KEY` securely in your environment, then run:

```sh
node bin/zephira-mcp.mjs
```

Alternatively, use `npx -y github:sens663/zephira-mcp` as your client's command, with `ZEPHIRA_API_KEY` in its private environment configuration. This installs from this GitHub repository; it is not a claim that an npm registry package has been published. `configs/claude-desktop.example.json` provides a configuration example.

## Development and validation

```sh
npm run check
npm test
```

Tests cover canonical endpoint/header forwarding, JSON and SSE responses, protocol/session negotiation, notifications, provenance preservation, credential-safe errors, stdio framing and missing-key handling using fixtures. These tests do not consume real company-data credits or certify every supported client against a production account.

## Support

Setup documentation: https://zephira.ai/developers/mcp/. Support and security reports: support@zephira.ai. Report reproducible client-bridge issues in this repository without credentials or private company/account data.
