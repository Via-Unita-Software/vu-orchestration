# Prompt Authoring Guide

Prompts are Handlebars template files stored in the `prompts/` directory. They are loaded by the Runtime Worker at execution time, rendered with a context object assembled from the trigger event and context loaders, and sent to the LLM.

---

## How Prompts Relate to SOPs

Each SOP step references a prompt file via the `prompt` field:

```yaml
steps:
  - name: classify
    prompt: prompts/ticket-screener/classify.md
    model: claude-sonnet-4-20250514
    max_tokens: 1024
```

The path is relative to the Runtime Worker's working directory (the repository root in standard deployments). The file is read from disk at run time — not at startup — so you can update a prompt without rebuilding or restarting the service (a re-seed is required for cloud deployments; see `infra/scripts/seed.sh`).

---

## Handlebars Syntax Basics

The prompt renderer uses the [Handlebars](https://handlebarsjs.com/) templating library.

### Variable interpolation

```handlebars
{{event.subject}}
{{meta.tenant}}
```

Missing variables resolve to an empty string (not an error).

### Conditionals

```handlebars
{{#if freshdesk.conversations}}
Previous conversation history is available.
{{else}}
No previous conversations.
{{/if}}
```

### Iteration

```handlebars
{{#each freshdesk.conversations}}
- {{this.body_text}} (from {{this.from_email}})
{{/each}}
```

For object iteration, `{{@key}}` gives the key name:

```handlebars
{{#each docs.documents}}
### {{@key}}
{{this}}
{{/each}}
```

### Comments

```handlebars
{{!-- This is a template comment and will not appear in the rendered output --}}
```

Use comments to document available variables at the top of each prompt file.

---

## Complete Variable Reference

The following variables are available in every prompt template. All variables are populated at render time by the `PromptRenderer` class in `packages/runtime/src/llm/prompt.ts`.

---

### `event.*` — Event Payload Fields

The `event` object contains the `payload` of the `OrchestratorEvent`. The available fields depend on the trigger adapter that produced the event.

**GitHub / GitLab PR and MR events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.pr_number` | number | Pull request number (GitHub) |
| `event.mr_iid` | number | Merge request internal ID (GitLab) |
| `event.pr_title` | string | PR or MR title |
| `event.pr_url` | string | HTML URL of the PR |
| `event.base_branch` | string | Target branch (e.g. `main`) |
| `event.head_branch` | string | Source branch |
| `event.author` | string | PR / MR author username |
| `event.repo_full_name` | string | `owner/repo` slug |
| `event.owner` | string | Repository owner (GitHub) |
| `event.repo` | string | Repository name (GitHub) |
| `event.project_id` | string | GitLab project path or numeric ID |

**GitHub / GitLab push events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.ref` | string | Git ref that was pushed (e.g. `refs/heads/main`) |
| `event.commits` | array | Array of commit objects |
| `event.pusher` | string | Username of the pusher |
| `event.repo_full_name` | string | `owner/repo` slug |

**GitHub issue events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.issue_number` | number | Issue number |
| `event.issue_title` | string | Issue title |
| `event.author` | string | Issue author username |
| `event.repo_full_name` | string | `owner/repo` slug |

**Freshdesk / Jira ticket events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.ticket_id` | string | Ticket / issue ID |
| `event.subject` | string | Ticket subject line |
| `event.description` | string | Ticket body / description text |
| `event.sender_email` | string | Customer email address |
| `event.status` | string | Current ticket status |
| `event.tags` | array | Existing tags on the ticket |
| `event.group_id` | string | Assigned group ID |

**Jira-specific fields:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.issue_key` | string | Jira issue key (e.g. `PROJ-123`) |
| `event.summary` | string | Issue summary |
| `event.assignee` | string | Assignee display name |
| `event.issue_type` | string | Issue type name |

**HTTP / OpenWebUI events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.query` | string | User query or message text |
| `event.user_id` | string | User identifier |
| `event.type` | string | Event type from body |

**Schedule events:**

| Variable | Type | Description |
|----------|------|-------------|
| `event.schedule_name` | string | Name of the cron definition |
| `event.week` | string | Week label (if set in event payload) |
| `event.start_date` | string | Week start date |
| `event.end_date` | string | Week end date |

---

### `meta.*` — Runtime Metadata

Always present, regardless of trigger source.

| Variable | Type | Description |
|----------|------|-------------|
| `meta.tenant` | string | Tenant ID from `config.yaml` |
| `meta.triggeredBy` | string \| undefined | Source adapter type that produced the event |
| `meta.deduplicationKey` | string | Unique key used for deduplication (useful for debugging) |
| `meta.interactive` | boolean | `true` when called via `/api/chat` (OpenWebUI or direct API); `false` for webhook-triggered runs |

---

### `previous_step` — Multi-Step Chaining

In a SOP with multiple steps, `{{previous_step}}` contains the raw text output of the immediately preceding step.

```yaml
steps:
  - name: extract
    prompt: prompts/release/extract-prs.md
    model: claude-sonnet-4-20250514
    max_tokens: 1024

  - name: summarize
    prompt: prompts/release/summarize.md
    model: claude-sonnet-4-20250514
    max_tokens: 512
```

In `summarize.md`:

```handlebars
The previous step extracted the following PR list:

{{previous_step}}

Now write a one-paragraph executive summary of these changes.
```

`previous_step` is `undefined` (renders as empty string) for the first step.

---

### `freshdesk.*` — Freshdesk Context Loader

Available when `context` includes `type: freshdesk`.

| Variable | Type | Description |
|----------|------|-------------|
| `freshdesk.ticket` | object | Full Freshdesk ticket object from the API (`/api/v2/tickets/:id`) |
| `freshdesk.conversations` | array | Conversation entries from `/api/v2/tickets/:id/conversations`. Each entry has `body_text`, `from_email`, `created_at`, and other Freshdesk fields. |
| `freshdesk.ticketId` | string | The ticket ID used to fetch the data |

---

### `jira.*` — Jira Context Loader

Available when `context` includes `type: jira`.

| Variable | Type | Description |
|----------|------|-------------|
| `jira.issue` | object | Full Jira issue object from REST API v3 (`/rest/api/3/issue/:key`), including `fields` |
| `jira.comments` | array | Array of comment objects from `/rest/api/3/issue/:key/comment` |
| `jira.issueKey` | string | The issue key used to fetch the data |

---

### `repo.*` — Repo Context Loader

Available when `context` includes `type: repo`.

| Variable | Type | Description |
|----------|------|-------------|
| `repo.files` | object | Map of file path → file contents. Keys are the paths specified in `params.paths`. |
| `repo.url` | string | The repository URL that was cloned |

Iterate over files:

```handlebars
{{#each repo.files}}
### `{{@key}}`

```
{{this}}
```

{{/each}}
```

---

### `docs.*` — Docs Context Loader

Available when `context` includes `type: docs`.

| Variable | Type | Description |
|----------|------|-------------|
| `docs.documents` | object | Map of file path → file contents. Loads `.md`, `.txt`, and `.rst` files. Directories are expanded automatically. |

---

### `http.*` — HTTP Context Loader

Available when `context` includes `type: http`.

| Variable | Type | Description |
|----------|------|-------------|
| `http.response` | string \| object | Response body. If the `Content-Type` is `application/json`, this is a parsed object; otherwise it is a raw string. |
| `http.url` | string | The URL that was fetched |

---

## Multi-Step Prompts and Chaining

Use multi-step SOPs when the task benefits from decomposition:

1. **Step 1**: Extract or structure data (e.g. parse raw diff into a list of changed files)
2. **Step 2**: Reason over the structured data (e.g. assess risk of each change)
3. **Step 3**: Draft the output (e.g. write the PR review comment)

Each step gets the full context (event + all loaders) plus `{{previous_step}}` from the step before it. Only the **final step's output** is stored as the run result and passed to writeback adapters.

**Example: Two-step release notes generation**

`sops/release-notes.yaml`:
```yaml
steps:
  - name: extract
    prompt: prompts/release-notes/extract.md
    model: claude-sonnet-4-20250514
    max_tokens: 1024

  - name: format
    prompt: prompts/release-notes/format.md
    model: claude-sonnet-4-20250514
    max_tokens: 2048
    output_schema: ReleaseNotes
```

`prompts/release-notes/format.md`:
```handlebars
You previously extracted the following raw change list:

{{previous_step}}

Now format this as a customer-facing release note in this JSON structure:

```json
{
  "version": "{{event.version}}",
  "highlights": ["..."],
  "breaking_changes": [],
  "full_changelog": "..."
}
```

Return only the JSON object.
```

---

## Output Schema Prompting

When a SOP step sets `output_schema`, the runtime validates that the LLM response is a valid JSON object. To maximise first-attempt success:

1. Specify the exact JSON schema in the prompt.
2. Instruct the model to return **only** the JSON, with no surrounding text.
3. Provide an example in the prompt when the schema is complex.

```handlebars
Classify this ticket and return a JSON object with exactly this structure:

```json
{
  "classification": "<support|bug|feature-request|sales|spam|billing|other>",
  "confidence": 0.0,
  "suggested_tags": [],
  "suggested_group": "",
  "priority": "<low|medium|high|urgent>",
  "reasoning": ""
}
```

Return ONLY the JSON object. Do not include any explanatory text before or after it.
```

If the model returns a markdown code block (` ```json ... ``` `), the output guard strips it automatically before parsing. If it returns raw JSON, that is also handled. Only plain prose without any JSON will fail validation.

---

## Best Practices

### System prompt vs. user prompt

The current implementation sends the entire rendered Handlebars template as a single `user` message. There is no separate system prompt field in the SOP step schema. To achieve system-prompt-like framing, put role instructions at the top of the template:

```handlebars
You are a senior software engineer conducting a code review. Your feedback is
precise, constructive, and specific to the code shown below. You do not
comment on style unless it introduces bugs.

## Pull Request

...
```

The `system` parameter is supported by the `LLMClient` interface but is not currently exposed in the SOP schema. If you need a separate system prompt, it must be included in the prompt file.

### Token budgeting

Set `max_tokens` conservatively:

| Task type | Suggested `max_tokens` |
|-----------|----------------------|
| Classification with JSON output | 256–512 |
| Structured data extraction | 512–1024 |
| Code review or analysis | 2048–4096 |
| Document drafting | 2048–8192 |

The cost tracking in the Admin UI shows actual token usage per run. Use it to tune `max_tokens` after your first few runs.

### Temperature considerations

Temperature is not currently configurable in the SOP schema. The Anthropic and OpenAI clients use the model's default temperature. For classification tasks where you want deterministic output, include explicit instructions in the prompt: "Always return the most likely classification, not an ambiguous one."

### Prompt hygiene

- Keep prompts focused on a single task. Split complex tasks into multiple steps.
- Use Handlebars comments (`{{!-- ... --}}`) to document available variables at the top of each file.
- Avoid hardcoding values that come from the event payload — always use `{{event.*}}` so the SOP is reusable.
- Test prompts locally before deploying (see [docs/sops.md — How to Test a SOP Locally](sops.md#how-to-test-a-sop-locally)).

---

## Annotated Example Prompt

```handlebars
{{!--
  prompts/ticket-screener/classify.md
  
  Context variables available in this template:
    event.subject       — Ticket subject line (string)
    event.description   — Ticket body (string)
    event.sender_email  — Customer email (string)
    event.tags          — Current tags (array)
    freshdesk.ticket    — Full Freshdesk ticket object
    freshdesk.conversations — Conversation history (array)
    meta.tenant         — Tenant identifier (string)
    meta.interactive    — Whether called from chat UI (boolean)
--}}

{{!-- Role framing at the top of the file acts as a system prompt --}}
You are a support ticket classifier for a B2B software company.

## Ticket Information

**Subject:** {{event.subject}}

**From:** {{event.sender_email}}

**Description:**
{{event.description}}

{{!-- Conditionally include conversation history only when it exists --}}
{{#if freshdesk.conversations}}
**Previous Conversations:**
{{#each freshdesk.conversations}}
- {{this.body_text}}
{{/each}}
{{/if}}

## Task

Classify this ticket. Return a JSON object with no surrounding text:

```json
{
  "classification": "<support|bug|feature-request|sales|spam|billing|other>",
  "confidence": 0.95,
  "suggested_tags": ["authentication", "login"],
  "suggested_group": "Technical Support",
  "priority": "<low|medium|high|urgent>",
  "reasoning": "Brief explanation of the classification decision"
}
```

Classification rules:
- **support**: How-to questions, configuration help, usage questions
- **bug**: Software errors, unexpected behavior, crashes
- **feature-request**: New feature asks, enhancement requests
- **sales**: Pricing, licensing, upgrade inquiries
- **spam**: Irrelevant, automated, or suspicious messages
- **billing**: Invoice, payment, subscription issues
- **other**: Anything that does not fit above

Respond ONLY with the JSON object.
```
