# BastionMCP — Workspace Rules

## A.0 — How Antigravity should use this document
1. Before any backend task, check this file for the relevant MCP tool.
2. If a capability is listed under "Not possible via MCP — custom tool needed," use the provided custom MCP server template instead of forcing an existing tool.
3. Always obey the Security Rules (Section B, in `C:\Users\DANIEL\.gemini\GEMINI.md`) regardless of what's asked — if a request conflicts with a security rule, stop and ask.
4. Default to read-only / plan-first. Never execute a destructive or money-moving action without showing the exact command/payload and getting a go-ahead first, unless pre-authorized for this session.

## A.1 — Supabase MCP
**Can do:** run arbitrary SQL (`execute_sql`), apply/generate migrations, list tables/columns/relationships/extensions, generate TS types, pull security/performance advisories (`get_advisors` — RLS gaps, missing indexes), pull live logs, manage schema branches (create/list/merge/rebase/delete/reset), list/deploy/inspect Edge Functions, search Supabase docs, project/org admin, update storage config (paid plans).

**Not possible via MCP — build custom:**
- Bulk Auth user management with custom claims → thin custom tool using `supabase-js`'s `auth.admin` methods.
- Row-level data seeding for branches (branches copy schema only, not data) → custom `seed_branch` tool running a seed SQL script.
- Cross-project secret sync (e.g. mirroring a Supabase service key into Cloudflare Worker secrets) → Section A.4 orchestration tool.

**Setup (hosted, recommended):**
```json
"supabase-bastionmcp": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=your-project-ref&read_only=true"
}
```
Always pass `project_ref` — omitting it exposes every project in your org. Default `read_only=true`; add a `-write` variant only when actively supervising a migration.

## A.2 — Cloudflare MCP
**Can do:** full Workers lifecycle, DNS record management, R2/D1/KV, Zero Trust/Access policies, firewall/load balancer config, analytics, browser rendering, secrets (`wrangler secret put` equivalents via API).

**Not possible via MCP — build custom:**
- Custom business-logic endpoints inside your own Workers (e.g. triggering a specific flow on demand) → use `workers-mcp` to expose specific Worker methods as MCP tools:
```typescript
import { WorkerEntrypoint } from "cloudflare:workers";
import { ProxyToSelf } from "workers-mcp";

export default class MyWorker extends WorkerEntrypoint {
  async runPostingFlow(accountId: string): Promise<string> {
    return `Posting flow triggered for ${accountId}`;
  }
  async fetch(request: Request) {
    return new ProxyToSelf(this).fetch(request);
  }
}
```
Install: `npm install workers-mcp` then `npx workers-mcp setup`. Redeploy after any method signature change.
- Billing-tier/plan changes — read-only via MCP; treat as manual-only.

**Setup:**
```json
"cloudflare-bastionmcp": {
  "type": "http",
  "url": "https://mcp.cloudflare.com/mcp"
}
```
OAuth on connect — pick minimum scopes (e.g. Workers Edit + DNS Edit for one zone). For a self-hosted wrapper, use a scoped API token, never the Global API Key.

## A.3 — Paystack MCP (Not Active for BastionMCP Subscriptions)
*BastionMCP uses Stripe for payments. Included for reference only.*
**Official server can do:** exposes the entire Paystack API dynamically by parsing the OpenAPI specification at runtime via two generic tools:
- `get_paystack_operation` — fetch operation details by operation ID.
- `make_paystack_request` — execute any Paystack API request.

**Official test server setup:**
```json
"paystack-bastionmcp": {
  "command": "npx",
  "args": ["-y", "@paystack/mcp-server", "--api-key", "sk_test_YOUR_TEST_KEY"]
}
```

## A.4 — Custom cross-service orchestration tool
Nothing off-the-shelf verifies consistency *across* Supabase, Cloudflare, and Stripe/Paystack at once. Build once, reuse for every project:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const STRIPE_BASE = "https://api.stripe.com/v1";

const server = new McpServer({ name: "consistency-check", version: "1.0.0" });

server.tool("check_plan_price_consistency", {}, async () => {
  const { data: plans } = await supabase.from("subscriptions").select("stripe_customer_id, tier");
  // Implement Stripe status checks and database consistency checks
  return { content: [{ type: "text", text: "Consistency check passed" }] };
});
```

## A.5 — Ongoing behavior (every backend task, this project)
**Before starting:**
- Re-read this file and `C:\Users\DANIEL\.gemini\GEMINI.md`.
- State which MCP connection(s) you'll use and confirm scope (read-only vs. write, test vs. live).
- Pre-flight: confirm you're pointed at the correct project (not another project sharing the global MCP config), test/live mode matches intent, no naming mismatches between what the task expects and what exists.

**After completing:**
- Post-flight: re-query affected resources to confirm the change applied, check for orphaned resources, cross-check consistency across services if the change spans more than one.
- Summarize what changed in plain text.
