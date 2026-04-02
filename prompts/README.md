# Prompts

Handlebars prompt templates used by the Via Unita Orchestration SOPs.

Each `.md` file is rendered at runtime with a context object assembled from the SOP's `context` loaders. Variables are injected using standard Handlebars syntax: `{{variable}}`, `{{#if ...}}`, `{{#each ...}}`.

---

## Available Handlebars Variables by Context Loader

### `event` — Always Present

The raw `OrchestratorEvent` payload forwarded from the trigger adapter.

| Variable | Type | Description |
|---|---|---|
| `event.ticket_id` | string | Freshdesk/Jira ticket ID |
| `event.subject` | string | Ticket or message subject |
| `event.description` | string | Body/description text |
| `event.sender_email` | string | Sender email address |
| `event.sender_name` | string | Sender display name |
| `event.tags` | array | Existing tags |
| `event.status` | string | Current ticket/item status |
| `event.pr_number` | number | GitHub/GitLab PR/MR number |
| `event.pr_title` | string | PR/MR title |
| `event.base_branch` | string | Target branch |
| `event.head_branch` | string | Source branch |
| `event.author` | string | PR/MR author username |
| `event.repo_full_name` | string | `owner/repo` slug |
| `event.owner` | string | Repository owner |
| `event.repo` | string | Repository name |
| `event.diff_url` | string | URL to the raw diff |
| `event.compare_url` | string | URL to compare view |
| `event.version` | string | Release version tag |
| `event.merged_prs` | array | Merged PR objects |
| `event.project_id` | string | GitLab project ID |
| `event.mr_iid` | number | GitLab MR internal ID |
| `event.query` | string | User's chat question |
| `event.user_id` | string | User identifier |
| `event.week` | string | Week label (e.g. `2026-W14`) |
| `event.start_date` | string | ISO week start date |
| `event.end_date` | string | ISO week end date |

---

### `meta` — Always Present

Runtime metadata injected by the orchestrator.

| Variable | Type | Description |
|---|---|---|
| `meta.tenant` | string | Tenant/org identifier |
| `meta.triggeredBy` | string | Source adapter that fired the trigger |
| `meta.deduplicationKey` | string | Unique key to prevent double-processing |
| `meta.interactive` | boolean | Whether running in interactive (chat) mode |

---

### `freshdesk` — Loader type: `freshdesk`

Fetches the ticket and its conversation history from Freshdesk.

Config params: `base_url`, `api_key`

| Variable | Type | Description |
|---|---|---|
| `freshdesk.ticket` | object | Full ticket object from the Freshdesk API |
| `freshdesk.conversations` | array | Conversation entries; each has `body_text`, `from_email`, `created_at` |

---

### `docs` — Loader type: `docs`

Loads one or more local documentation files into memory.

Config params: `paths` (array of file paths or directory paths)

| Variable | Type | Description |
|---|---|---|
| `docs.documents` | object | Map of `{ "path/to/file.md": "<file contents>", ... }` |

Iterate with:
```handlebars
{{#each docs.documents}}
### {{@key}}
{{this}}
{{/each}}
```

---

### `http` — Loader type: `http`

Fetches a remote URL and exposes the response body.

Config params: `url`

| Variable | Type | Description |
|---|---|---|
| `http.response` | string | Raw response body from the URL |

---

### `repo` — Loader type: `repo`

Reads source files from the local repository.

Config params: `paths` (array of file or directory paths)

| Variable | Type | Description |
|---|---|---|
| `repo.files` | object | Map of `{ "src/index.ts": "<file contents>", ... }` |
| `repo.url` | string | Repository URL |

Iterate with:
```handlebars
{{#each repo.files}}
### `{{@key}}`
```
{{this}}
```
{{/each}}
```

---

## Prompt Directory Structure

```
prompts/
  ticket-screener/
    classify.md       — Ticket classification (→ TicketClassification schema)
  pr-review/
    review.md         — Pull/merge request code review
  support-draft/
    draft.md          — Customer support reply draft
  code-qa/
    query.md          — Codebase Q&A with source citations
  release-notes/
    generate.md       — Structured release notes (→ ReleaseNotes schema)
  weekly-digest/
    digest.md         — Weekly engineering management digest
```

---

## Handlebars Tips

- Use `{{!-- comment --}}` for template comments (stripped at render time).
- Use `{{#if variable}}...{{/if}}` to conditionally include sections.
- Use `{{#each array}}...{{/each}}` to iterate; `{{@key}}` gives the key in object iteration.
- Prompt files are rendered **before** being sent to the LLM — the rendered text is what the model receives.
- Variables not present in context resolve to an empty string, not an error.
