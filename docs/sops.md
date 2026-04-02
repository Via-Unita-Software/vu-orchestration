# SOP Authoring Reference

A Standard Operating Procedure (SOP) is a YAML file that defines an automated workflow: which events trigger it, what data to fetch, which LLM prompts to run, and where to write the results.

SOPs live in the `sops/` directory. They are loaded at Orchestrator startup. All changes require a re-deploy or re-seed to take effect.

---

## When to Create a SOP

Create a SOP when you want to:

- React to an external event (PR opened, ticket created, push to main) with AI-generated content
- Produce a structured artifact (classification, code review, release notes) from an incoming event
- Write results back to an external system automatically (comment on a PR, tag a ticket, send an email)
- Run a scheduled AI task (weekly digest, nightly report)

Do not create a SOP for logic that requires real-time human interaction within the execution — the system is designed for autonomous, asynchronous operation. Use `require_human_approval: true` if you need a human to sign off before writebacks are performed.

---

## Full YAML Field Reference

### `name`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `pr-review` |

A unique, machine-readable identifier for this SOP. Used in logs, the Admin UI, and the `admin/runs` API response. Must be unique across all SOPs loaded at runtime.

---

### `description`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `Automatic code review for pull requests and merge requests` |

Human-readable description shown in the Admin UI and the `/admin/sops` API response.

---

### `version`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `"1.0"` |

Semantic version of this SOP definition. Quoted to avoid YAML interpreting `1.0` as a float.

---

### `trigger`

| | |
|--|--|
| Type | `object` |
| Required | Yes |

Defines which events activate this SOP.

#### `trigger.source`

| | |
|--|--|
| Type | `string[]` |
| Required | Yes |
| Example | `[github, gitlab]` |

List of adapter source names that can trigger this SOP. Must match the `type` property of a registered `TriggerAdapter`. See [Available Trigger Sources](#available-trigger-sources).

#### `trigger.type`

| | |
|--|--|
| Type | `string[]` |
| Required | Yes |
| Example | `[pr.opened, mr.opened]` |

List of normalized event type strings. The Orchestrator only activates the SOP when `event.type` is in this list.

#### `trigger.filter`

| | |
|--|--|
| Type | `Record<string, string \| string[]>` |
| Required | No |

Additional conditions on `event.payload` fields. Each key is a payload field name; the value is either a single accepted string or an array of accepted strings. All conditions must match (logical AND). If a payload field is missing, the filter does not match.

```yaml
trigger:
  source: [github, gitlab]
  type: [pr.opened, mr.opened]
  filter:
    base_branch:
      - main
      - develop
      - master
```

The SOP router uses a **first-match-wins** strategy. If multiple SOPs match an event, only the first one (in load order, which is alphabetical by filename) is executed.

---

### `context`

| | |
|--|--|
| Type | `ContextEntry[]` |
| Required | No |
| Default | `[]` |

List of context loaders to run before prompt execution. Each loader fetches additional data and injects it into the Handlebars template context. Loaders run sequentially in the order listed.

```yaml
context:
  - type: freshdesk
    params:
      base_url: "${FRESHDESK_URL}"
      api_key: "${FRESHDESK_API_KEY}"
  - type: docs
    params:
      paths:
        - docs/architecture.md
```

#### `context[].type`

| | |
|--|--|
| Type | `string` |
| Required | Yes |

The loader type identifier. See [Available Context Loader Types](#available-context-loader-types).

#### `context[].params`

| | |
|--|--|
| Type | `Record<string, unknown>` |
| Required | No |

Loader-specific configuration. Each loader type documents its own params. Values starting with `${...}` are resolved from environment variables at runtime.

---

### `steps`

| | |
|--|--|
| Type | `Step[]` |
| Required | Yes |
| Minimum | 1 step |

Ordered list of LLM prompt steps. Steps execute sequentially. The output of each step is available to the next step as `{{previous_step}}`.

#### `steps[].name`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `classify` |

Unique name for this step within the SOP. Used in logs.

#### `steps[].prompt`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `prompts/ticket-screener/classify.md` |

Path to the Handlebars prompt template file, relative to the working directory of the Runtime Worker. See [docs/prompts.md](prompts.md) for the full variable reference.

#### `steps[].model`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `claude-sonnet-4-20250514` |

Model identifier. The runtime selects the LLM client based on the model prefix:
- `claude-*` → Anthropic client
- All others → OpenAI client (also used for Azure OpenAI)

#### `steps[].max_tokens`

| | |
|--|--|
| Type | `integer` (positive) |
| Required | Yes |
| Example | `1024` |

Maximum number of tokens in the LLM response. A good starting value is 1024 for classification tasks, 2048–4096 for free-form text, and 512 for summarisation.

#### `steps[].output_schema`

| | |
|--|--|
| Type | `string` |
| Required | No |
| Example | `TicketClassification` |

When set, the runtime validates the LLM response as JSON after each attempt. If validation fails, the error is sent back to the model and the step is retried (up to `guardrails.max_retries` times). The value is a schema name used for logging — actual schema enforcement is against `{ type: "object" }` (valid JSON object). Include explicit JSON schema instructions in your prompt for field-level validation.

---

### `writeback`

| | |
|--|--|
| Type | `WritebackEntry[]` |
| Required | No |
| Default | `[]` |

List of writeback actions to execute after all steps complete. Writebacks execute sequentially using the **final step's output** and the original trigger event as parameters.

#### `writeback[].type`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `github` |

Writeback adapter type. Must match a registered `WritebackAdapter`. See [docs/adapters.md](adapters.md).

#### `writeback[].action`

| | |
|--|--|
| Type | `string` |
| Required | Yes |
| Example | `pr_comment` |

The action to perform. Must be in the adapter's `allowedActions` list.

#### `writeback[].params`

| | |
|--|--|
| Type | `Record<string, unknown>` |
| Required | No |

Adapter-specific parameters. The runtime automatically adds `result` (the final step output string) and `event` (the original `OrchestratorEvent`) to the params object before passing it to the adapter. Params can reference event payload fields using standard template syntax (`{{event.ticket_id}}`).

---

### `guardrails`

| | |
|--|--|
| Type | `object` |
| Required | No |
| Default | `{ max_retries: 0, timeout_seconds: 300, require_human_approval: false }` |

#### `guardrails.max_retries`

| | |
|--|--|
| Type | `integer >= 0` |
| Default | `0` |

Number of times to retry a step when output schema validation fails. A value of `2` means up to 3 total attempts. BullMQ retries on unhandled job failures independently of this setting.

#### `guardrails.timeout_seconds`

| | |
|--|--|
| Type | `integer > 0` |
| Default | `300` |

Total wall-clock time budget for the entire SOP run (all steps + writebacks). If the run exceeds this duration, it is marked `failed` with a timeout error.

#### `guardrails.require_human_approval`

| | |
|--|--|
| Type | `boolean` |
| Default | `false` |

When `true`, the Email writeback adapter will execute. When `false`, the Email adapter refuses to send (enforcing human oversight for outbound email). Has no effect on non-email adapters currently.

---

## Available Context Loader Types

| Type | Template Key | Description | Required Params |
|------|-------------|-------------|-----------------|
| `freshdesk` | `freshdesk` | Fetches ticket and conversation history from Freshdesk API | `base_url`, `api_key` |
| `jira` | `jira` | Fetches issue and comments from Jira REST API v3 | `base_url`, `api_token`, `email` |
| `repo` | `repo` | Shallow-clones a Git repo and reads specified files | `url` (or from event payload), `paths` |
| `docs` | `docs` | Reads local `.md`, `.txt`, or `.rst` files or directories | `paths`, optional `base_path` |
| `http` | `http` | Fetches a URL and exposes the response body | `url`, optional `method`, `headers` |

Template variables injected by each loader are documented in [docs/prompts.md](prompts.md).

---

## Available Trigger Sources

| Source | Adapter Class | Validated By | Normalized Event Types |
|--------|--------------|-------------|------------------------|
| `github` | `GitHubTriggerAdapter` | HMAC-SHA256 (`x-hub-signature-256`) | `pr.opened`, `pr.merged`, `pr.<action>`, `push`, `issue.created`, `issue.<action>`, `github.<event>` |
| `gitlab` | `GitLabTriggerAdapter` | Token header (`x-gitlab-token`) | `mr.opened`, `mr.merged`, `mr.<action>`, `mr.note`, `push`, `issue.created`, `issue.<action>`, `gitlab.<object_kind>` |
| `freshdesk` | `FreshdeskTriggerAdapter` | Optional header (`x-freshdesk-secret`) or open | `ticket.created`, `ticket.updated` |
| `jira` | `JiraTriggerAdapter` | Shared secret header (`x-atlassian-secret`) | `issue.created`, `issue.updated`, `issue.transitioned`, `jira.<event>` |
| `http` | `HttpTriggerAdapter` | Optional header (`x-webhook-secret`) or open | Any — reads `type` or `event_type` from the request body; defaults to `http.request` |
| `schedule` | `ScheduleTriggerAdapter` | N/A (internal) | Configured via `emit_event_type` in the cron definition |

---

## Filter Conditions

The `trigger.filter` block applies additional constraints on `event.payload` after source and type matching:

```yaml
trigger:
  source: [github]
  type: [pr.opened]
  filter:
    base_branch: main          # single accepted value
    # OR:
    base_branch:
      - main
      - master
      - develop                # list of accepted values (OR within the list)
```

**Semantics**:
- Each key maps to a field in `event.payload`.
- If the key is a string, the payload field must equal that string exactly.
- If the key is a list, the payload field must equal any one of the listed strings.
- All keys must match (logical AND across keys).
- If a payload field referenced in the filter is absent, the filter does not match and the SOP is skipped.

The filter is evaluated after source and type matching. Only one SOP can match per event (first match wins).

---

## Output Schemas

When `steps[].output_schema` is set, the runtime:

1. Tries to extract JSON from the LLM response. It first looks for a ` ```json ... ``` ` code block, then falls back to the first `{...}` match.
2. Parses the extracted string as JSON.
3. Validates that the parsed value is a JSON object.
4. If invalid, constructs a retry message:
   ```
   Your previous response failed validation: <error details>. Please fix and return valid JSON.
   ```
5. Sends the retry message to the model as a new user turn, up to `max_retries` times.
6. If the maximum retry count is reached without a valid response, the run fails.

To leverage output schema enforcement effectively, instruct the model in the prompt to return only JSON (no surrounding text) and specify the exact schema. See [docs/prompts.md](prompts.md) for examples.

---

## Guardrails Reference Summary

| Field | Default | Purpose |
|-------|---------|---------|
| `max_retries` | `0` | Retries per step on schema validation failure |
| `timeout_seconds` | `300` | Total run wall-clock time limit |
| `require_human_approval` | `false` | Gate for Email writeback adapter |

---

## Walk-Through: New Employee Onboarding SOP

This example creates a SOP that triggers when a Jira issue of type `Onboarding` is created, generates a personalized onboarding checklist using the LLM, and posts it as a comment on the Jira issue.

### 1. Create the SOP file

`sops/employee-onboarding.yaml`:

```yaml
name: employee-onboarding
description: Generates a personalized onboarding checklist for new employees
version: "1.0"

trigger:
  source:
    - jira
  type:
    - issue.created
  filter:
    issue_type: Onboarding

context:
  - type: jira
    params:
      base_url: "${JIRA_URL}"
      api_token: "${JIRA_API_TOKEN}"
      email: "${JIRA_EMAIL}"
  - type: docs
    params:
      paths:
        - docs/onboarding-handbook.md

steps:
  - name: generate-checklist
    prompt: prompts/employee-onboarding/checklist.md
    model: claude-sonnet-4-20250514
    max_tokens: 2048

writeback:
  - type: jira
    action: comment
    params:
      issue_key: "{{event.issue_key}}"

guardrails:
  max_retries: 1
  timeout_seconds: 120
  require_human_approval: false
```

### 2. Create the prompt template

`prompts/employee-onboarding/checklist.md`:

```handlebars
You are an HR assistant generating an onboarding checklist for a new employee.

## New Employee Details

**Name:** {{jira.issue.fields.summary}}
**Role:** {{jira.issue.fields.customfield_role}}
**Start Date:** {{jira.issue.fields.customfield_start_date}}

{{#if docs.documents}}
## Company Handbook Reference

{{#each docs.documents}}
### {{@key}}
{{this}}
{{/each}}
{{/if}}

## Task

Generate a personalized onboarding checklist for the first 30 days.
Include:
- Day 1 administrative tasks (accounts, access, equipment)
- Week 1 team introductions and orientation meetings
- Week 2–4 role-specific ramp-up tasks

Format as a structured markdown checklist.
```

### 3. Store Jira credentials in Key Vault

```bash
az keyvault secret set --vault-name your-company-dev-kv --name JIRA-URL --value "https://yourcompany.atlassian.net"
az keyvault secret set --vault-name your-company-dev-kv --name JIRA-API-TOKEN --value "<your-jira-api-token>"
az keyvault secret set --vault-name your-company-dev-kv --name JIRA-EMAIL --value "automation@yourcompany.com"
```

### 4. Seed and test

```bash
./infra/scripts/seed.sh --tenant-id your-company --environment dev --config-file config/config.yaml

# Create a Jira issue of type "Onboarding" and watch the run appear:
curl -H "Authorization: Bearer <api-key>" \
  "https://.../admin/runs?sop=employee-onboarding&limit=5"
```

---

## How to Test a SOP Locally

You can test a SOP without deploying to Azure by sending a direct HTTP request to the `/api/run` endpoint on a locally running Orchestrator.

### 1. Start local services

```bash
# In one terminal: start Redis
docker run -p 6379:6379 redis:7-alpine

# In another terminal: start PostgreSQL
docker run -p 5432:5432 -e POSTGRES_PASSWORD=localpass -e POSTGRES_DB=viaunita postgres:16-alpine

# Run migrations
DATABASE_URL="postgresql://postgres:localpass@localhost:5432/viaunita" \
  pnpm --filter @vu/orchestrator db:migrate
```

### 2. Set environment variables

```bash
export REDIS_URL="redis://localhost:6379"
export DATABASE_URL="postgresql://postgres:localpass@localhost:5432/viaunita"
export ANTHROPIC_API_KEY="sk-ant-..."
export API_KEY="local-test-key"
export SOPS_DIR="./sops"
export PROMPTS_DIR="./prompts"
```

### 3. Start the Orchestrator and Worker

```bash
# Terminal 1: Orchestrator
pnpm --filter @vu/orchestrator dev

# Terminal 2: Runtime Worker
pnpm --filter @vu/runtime dev
```

### 4. Send a test event

```bash
curl -X POST http://localhost:3000/api/run \
  -H "Authorization: Bearer local-test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "id": "test-001",
      "source": "freshdesk",
      "sourceEventId": "12345",
      "type": "ticket.created",
      "timestamp": "2026-04-01T10:00:00Z",
      "payload": {
        "ticket_id": "12345",
        "subject": "Cannot log in to the app",
        "description": "I keep getting a 401 error when I try to sign in.",
        "sender_email": "customer@example.com",
        "tags": [],
        "status": "open"
      },
      "meta": {
        "tenant": "your-company",
        "deduplicationKey": "test:freshdesk:12345",
        "interactive": false
      }
    }
  }'
```

Then poll for the result:

```bash
curl -H "Authorization: Bearer local-test-key" \
  http://localhost:3000/api/run/<runId>
```

Or use `/api/chat` for a synchronous response (waits up to 30 s):

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer local-test-key" \
  -H "Content-Type: application/json" \
  -d '{ "event": { ... }, "timeoutMs": 30000 }'
```
