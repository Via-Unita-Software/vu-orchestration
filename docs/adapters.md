# Adapter Development Guide

Adapters are the integration points between the Via Unita Orchestration Layer and external systems. There are two kinds:

- **Trigger adapters** receive webhooks from external systems and translate them into normalized `OrchestratorEvent` objects.
- **Writeback adapters** execute a specific action on an external system using the LLM result and event context.

Both kinds are defined by TypeScript interfaces in `packages/core`. The built-in adapters live in `packages/adapters`.

---

## Core Interfaces

### TriggerAdapter

```typescript
// packages/core/src/triggers.ts

export interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer | string;
  params?: Record<string, string>;
}

export interface TriggerAdapter {
  type: string;
  parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent>;
  validateSignature(req: IncomingRequest): Promise<boolean>;
}
```

- `type` must be a unique lowercase string identifier (e.g. `github`, `jira`). It appears in the URL `POST /webhooks/:adapterType` and in SOP `trigger.source` lists.
- `validateSignature` is called before `parseWebhook`. Return `false` to reject the request with HTTP 401.
- `parseWebhook` must return a fully valid `OrchestratorEvent`. Use the `createEvent` helper from `@vu/core` to generate the `id` and `timestamp` automatically.

### WritebackAdapter

```typescript
// packages/core/src/writeback.ts

export interface WritebackAction {
  type: string;
  action: string;
  params: Record<string, unknown>;
}

export interface WritebackResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface WritebackAdapter {
  type: string;
  allowedActions: string[];
  execute(action: WritebackAction): Promise<WritebackResult>;
}
```

- `type` is the adapter identifier used in SOP `writeback[].type`.
- `allowedActions` is a hardcoded list of action names this adapter supports. The runtime validates the requested action against this list before calling `execute`. This enforces the conservative writeback principle — an adapter can never be coerced into performing an undeclared operation.
- `execute` should return `{ success: false, error: "..." }` on failure rather than throwing, to allow other writebacks to continue executing.

---

## Implementing a Trigger Adapter: Slack Example

The following example shows how to implement a trigger adapter that receives Slack slash command events.

### Step 1: Define the adapter class

`packages/adapters/src/triggers/slack.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';
import { createEvent } from '@vu/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu/core';

export interface SlackTriggerConfig {
  tenant: string;
  signingSecret: string;
}

export class SlackTriggerAdapter implements TriggerAdapter {
  type = 'slack';

  constructor(private config: SlackTriggerConfig) {}

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    if (!timestamp || !signature) return false;

    // Reject requests older than 5 minutes to prevent replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : JSON.stringify(req.body);

    const sigBase = `v0:${timestamp}:${rawBody}`;
    const expected = 'v0=' + createHmac('sha256', this.config.signingSecret)
      .update(sigBase)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);
    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
  }

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const body = req.body as Record<string, string>;

    // Slack sends slash command data as URL-encoded form
    const command = body.command || '/unknown';
    const text = body.text || '';
    const userId = body.user_id || '';
    const channelId = body.channel_id || '';

    return createEvent({
      source: 'slack',
      sourceEventId: `${userId}:${Date.now()}`,
      type: 'slash_command',
      payload: {
        command,
        text,
        user_id: userId,
        channel_id: channelId,
        response_url: body.response_url,
      },
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `slack:${userId}:${Math.floor(Date.now() / 1000)}`,
        interactive: true,
      },
    });
  }
}
```

### Step 2: Export from the triggers index

`packages/adapters/src/triggers/index.ts`:

```typescript
// Add alongside the existing exports:
export { SlackTriggerAdapter } from './slack.js';
export type { SlackTriggerConfig } from './slack.js';
```

### Step 3: Register in the Orchestrator

In your Orchestrator startup code (or the entry point that calls `createServer`), instantiate and register the adapter:

```typescript
import { SlackTriggerAdapter } from '@vu/adapters';

const adapters = new Map<string, TriggerAdapter>();
adapters.set('slack', new SlackTriggerAdapter({
  tenant: config.tenant.id,
  signingSecret: resolvedSecrets.SLACK_SIGNING_SECRET,
}));
```

Slack will now send events to `POST /webhooks/slack`.

---

## Implementing a Writeback Adapter: Slack Example

`packages/adapters/src/writebacks/slack.ts`:

```typescript
import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu/core';

export interface SlackWritebackConfig {
  botToken: string;
}

export class SlackWritebackAdapter implements WritebackAdapter {
  type = 'slack';
  allowedActions = ['post_message', 'update_message'];

  constructor(private config: SlackWritebackConfig) {}

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { action: actionType, params } = action;
    const headers = {
      Authorization: `Bearer ${this.config.botToken}`,
      'Content-Type': 'application/json',
    };

    try {
      if (actionType === 'post_message') {
        const { channel, text, thread_ts } = params as Record<string, string>;
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel, text, thread_ts }),
        });
        const result = await response.json() as Record<string, unknown>;
        if (!result.ok) {
          return { success: false, error: `Slack API error: ${result.error}` };
        }
        return { success: true, output: { ts: result.ts, channel: result.channel } };
      }

      if (actionType === 'update_message') {
        const { channel, ts, text } = params as Record<string, string>;
        const response = await fetch('https://slack.com/api/chat.update', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel, ts, text }),
        });
        const result = await response.json() as Record<string, unknown>;
        if (!result.ok) {
          return { success: false, error: `Slack API error: ${result.error}` };
        }
        return { success: true, output: { ts: result.ts } };
      }

      return { success: false, error: `Unknown action: ${actionType}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
```

Export from the writebacks index:

```typescript
export { SlackWritebackAdapter } from './slack.js';
export type { SlackWritebackConfig } from './slack.js';
```

Register in the Runtime Worker startup:

```typescript
import { SlackWritebackAdapter } from '@vu/adapters';
import { WritebackAdapterRegistry } from '@vu/runtime';

const writebackRegistry = new WritebackAdapterRegistry();
writebackRegistry.register(new SlackWritebackAdapter({
  botToken: resolvedSecrets.SLACK_BOT_TOKEN,
}));
```

---

## How to Register Adapters

### In the Orchestrator

The Orchestrator accepts a `Map<string, TriggerAdapter>` in its `ServerDependencies`. Populate it before calling `createServer`:

```typescript
import { createServer } from '@vu/orchestrator';
import { GitHubTriggerAdapter, JiraTriggerAdapter } from '@vu/adapters';

const adapters = new Map<string, TriggerAdapter>([
  ['github', new GitHubTriggerAdapter({ tenant, webhookSecret })],
  ['jira', new JiraTriggerAdapter({ tenant, sharedSecret })],
]);

const app = createServer({ config, sops, adapters, queue, dedup, store, apiKey });
```

The adapter `type` property must match the map key. The key is also the `:adapterType` URL segment in `POST /webhooks/:adapterType`.

### In the Runtime Worker

The Worker accepts a `WritebackAdapterRegistry` in its `WorkerDeps`. Use the `register` method:

```typescript
import { createWorker, WritebackAdapterRegistry } from '@vu/runtime';
import { GitHubWritebackAdapter, FreshdeskWritebackAdapter } from '@vu/adapters';

const writebackRegistry = new WritebackAdapterRegistry();
writebackRegistry.register(new GitHubWritebackAdapter({ apiToken }));
writebackRegistry.register(new FreshdeskWritebackAdapter({ apiKey, domain }));

const worker = createWorker({ redis, runStore, contextRegistry, writebackRegistry, promptRenderer, config });
```

---

## Available Trigger Adapters

| Adapter | Source String | Authentication | Supported Event Types |
|---------|--------------|---------------|----------------------|
| `GitHubTriggerAdapter` | `github` | HMAC-SHA256 (`x-hub-signature-256`) | `pr.opened`, `pr.merged`, `pr.<action>`, `push`, `issue.created`, `issue.<action>`, `github.<event>` |
| `GitLabTriggerAdapter` | `gitlab` | Token header (`x-gitlab-token`) | `mr.opened`, `mr.merged`, `mr.<action>`, `mr.note`, `push`, `issue.created`, `issue.<action>`, `gitlab.<object_kind>` |
| `FreshdeskTriggerAdapter` | `freshdesk` | Optional: header `x-freshdesk-secret`, or open (IP whitelist) | `ticket.created`, `ticket.updated` |
| `JiraTriggerAdapter` | `jira` | Shared secret header (`x-atlassian-secret`) | `issue.created`, `issue.updated`, `issue.transitioned`, `jira.<event>` |
| `HttpTriggerAdapter` | `http` | Optional: header `x-webhook-secret`, or open | Any — reads `type` or `event_type` from the body; defaults to `http.request` |
| `ScheduleTriggerAdapter` | `schedule` | N/A (internal cron) | Configurable via `emit_event_type` per cron definition |

---

## Available Writeback Adapters

| Adapter | Type String | Allowed Actions | Notes |
|---------|------------|----------------|-------|
| `GitHubWritebackAdapter` | `github` | `pr_comment`, `issue_create`, `file_commit` | Uses `Authorization: token <token>` header |
| `GitLabWritebackAdapter` | `gitlab` | `mr_note`, `issue_create`, `file_commit` | Uses `PRIVATE-TOKEN` header; `file_commit` auto-detects create vs. update |
| `FreshdeskWritebackAdapter` | `freshdesk` | `note`, `tag`, `group`, `reply_draft` | `reply_draft` posts a public note |
| `JiraWritebackAdapter` | `jira` | `comment`, `label`, `transition` | Uses Jira REST API v3 ADF format for comments |
| `EmailWritebackAdapter` | `email` | `send` | Requires `require_human_approval: true` in SOP guardrails; implementation is a placeholder |

---

## Security Considerations

### Signature Validation

Every trigger adapter must implement `validateSignature`. The Orchestrator calls it before `parseWebhook`. An adapter that always returns `true` is a security risk — only do this for internal testing.

For HMAC-based validation (GitHub):
- Always use `timingSafeEqual` or equivalent for the comparison. String equality (`===`) is vulnerable to timing attacks.
- Validate the request timestamp if the upstream system provides one (Slack includes `x-slack-request-timestamp`). Reject requests older than 5 minutes to prevent replay attacks.
- Use the raw request body (`req.rawBody`) for the HMAC computation, not the parsed JSON. JSON re-serialization can change whitespace and field order.

For token-based validation (GitLab, Jira):
- Compare the token with a constant-time comparison when possible.
- Store the expected token in Key Vault, never in source code or Docker image layers.

### Conservative Writeback Principle

The `allowedActions` array is the enforcement point for the conservative writeback principle. It must be:
- Hardcoded in the class definition (not configurable at runtime).
- Narrowly scoped to specific, well-understood operations.
- Reviewed during code review as a security boundary.

Do not implement catch-all actions or actions that accept arbitrary API payloads.

---

## Contributing an Adapter Upstream

1. Fork the repository and create a branch: `feat/adapter-<name>`.
2. Implement the adapter in `packages/adapters/src/triggers/<name>.ts` or `packages/adapters/src/writebacks/<name>.ts`.
3. Export from the corresponding `index.ts`.
4. Add unit tests in `packages/adapters/src/__tests__/<name>.test.ts`. Test both `validateSignature` (valid and invalid inputs) and `parseWebhook` (at least one happy-path and one edge-case event type).
5. Document the adapter in this file: add a row to the trigger or writeback table, and document the event types produced.
6. Add an example SOP in `sops/` that demonstrates the adapter.
7. Open a pull request against `main`. The PR description should include:
   - What external system the adapter targets
   - The authentication mechanism
   - Which `allowedActions` the writeback adapter exposes and why
