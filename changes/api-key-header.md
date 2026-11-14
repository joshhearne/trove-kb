---
type: improvement
audience: admins
---
The REST API and MCP accept the API key in an `X-Auth-Token` header, for MCP connectors that can't send `Authorization`. Existing setups keep working.
