# Admin UI and API Reference

The Admin service provides a React dashboard and a JSON REST API for monitoring runs, inspecting results, and diagnosing failures.

---

## Accessing the Admin UI

After deployment, the Admin UI is available at the `adminUrl` output from `deploy.sh`:

```
https://your-company-dev-admin.westeurope.azurecontainerapps.io
```

All requests to `/admin/*` require a `Bearer` token:

```
Authorization: Bearer <your-api-key>
```

The same `api-key` you passed to `deploy.sh` is used for both the Admin API and the Orchestrator `/api/*` endpoints.

The React UI (served from `/`) reads this token from the browser's `localStorage` under the key `VU_API_KEY`. On first load, the UI will prompt you to enter the key.

---

## Dashboard

The dashboard (`/`) shows aggregated metrics for all runs across all SOPs.

### Metric Descriptions

| Metric | Description |
|--------|-------------|
| **Runs per day** | Bar chart of total run volume by calendar day (UTC). Includes runs of all statuses. |
| **Error rate** | Ratio of `failed` runs to total runs across all time. A value of `0.02` means 2% of runs failed. |
| **Total cost (USD)** | Sum of estimated LLM costs across all completed runs. Calculated as `(input_tokens / 1,000,000) × $3.00 + (output_tokens / 1,000,000) × $15.00` (Anthropic Claude Sonnet pricing as of deployment). |
| **Token usage** | Total tokens consumed (input + output) by calendar day. |
| **Runs by SOP** | Table showing each SOP's run count and success rate. Success rate = `completed / total`. |

Metrics are computed over all runs stored in PostgreSQL (up to 10,000 most recent in the current implementation). There is no time-range filter on the dashboard — use the Runs view for filtered queries.

---

## Runs View

The Runs view (`/runs`) lists individual run records with filtering controls.

### Status Meanings

| Status | Description |
|--------|-------------|
| `queued` | The job has been accepted and dispatched to the BullMQ queue. The Runtime Worker has not yet picked it up. |
| `running` | The Runtime Worker is currently executing the SOP (loading context, calling the LLM, executing writebacks). |
| `completed` | All steps and writebacks finished successfully. The result is available. |
| `failed` | The run failed due to an unhandled error, timeout, or exhausted retries. The `error` field contains the reason. |

### Filtering

Use the filter bar or query parameters to narrow the list:

| Filter | UI Control | API Param | Example |
|--------|-----------|-----------|---------|
| Status | Dropdown | `status` | `status=failed` |
| SOP name | Dropdown or text | `sop` | `sop=ticket-screener` |
| Date from | Date picker | `from` | `from=2026-03-01` |
| Date to | Date picker | `to` | `to=2026-03-31` |
| Page | Pagination | `page` | `page=2` |
| Page size | Dropdown | `limit` | `limit=50` |

---

## Run Detail

Click any run in the list (or call `GET /admin/runs/:id`) to open the run detail view.

### Fields

| Field | Description |
|-------|-------------|
| **Run ID** | UUID assigned at job creation. Use this to correlate logs across Orchestrator and Worker. |
| **SOP name** | Which SOP was executed. |
| **Event source** | Trigger adapter type that produced the event (e.g. `github`, `freshdesk`). |
| **Event type** | Normalized event type (e.g. `pr.opened`, `ticket.created`). |
| **Status** | Current run status (see table above). |
| **Created at** | UTC timestamp when the Orchestrator accepted the webhook and created the run record. |
| **Completed at** | UTC timestamp when the Worker finished (or failed). |
| **Duration (ms)** | Wall-clock time from `running` to `completed`/`failed`, in milliseconds. Does not include queue wait time. |
| **Tokens used** | Total tokens consumed (input + output across all steps). |
| **Cost (USD)** | Estimated LLM cost for this run. |
| **Trigger event** | The full `OrchestratorEvent` JSON that triggered this run. Useful for debugging filter mismatches. |
| **Result** | The final step's output. For structured JSON outputs, this is the raw JSON string returned by the LLM. |
| **Error** | If status is `failed`, the error message. Common values: timeout message, validation failure, API error. |

### Debugging Failures

1. Open the failing run's detail view.
2. Check the `error` field to identify the failure category:
   - **Timeout**: The SOP exceeded `guardrails.timeout_seconds`. Consider increasing the budget or splitting the SOP into smaller steps.
   - **Output validation failed**: The LLM did not return valid JSON after the configured retries. Check the prompt — it likely needs clearer JSON formatting instructions.
   - **API error**: The LLM or writeback API returned an error. Check your API key and rate limits.
   - **Context loader error**: A context loader (Freshdesk, Jira, HTTP) failed to fetch data. Check the credentials and URLs in Key Vault.
3. Inspect the `trigger_event` JSON to verify the event payload matched your expectations.
4. Check the Container Apps logs for detailed stack traces:

```bash
# Orchestrator logs
az containerapp logs show \
  --name your-company-dev-orchestrator \
  --resource-group your-company-dev-rg \
  --follow

# Runtime Worker logs
az containerapp logs show \
  --name your-company-dev-runtime \
  --resource-group your-company-dev-rg \
  --follow
```

---

## API Reference

All endpoints require `Authorization: Bearer <api-key>`.

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/admin/runs` | GET | List runs (paginated) | Bearer |
| `/admin/runs/:id` | GET | Single run detail | Bearer |
| `/admin/stats` | GET | Aggregated metrics | Bearer |
| `/admin/sops` | GET | Loaded SOP definitions | Bearer |

### GET /admin/runs

Returns a paginated list of runs, newest first.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | — | Filter by status: `queued`, `running`, `completed`, `failed` |
| `sop` | string | — | Filter by SOP name (exact match) |
| `from` | ISO date string | — | Filter runs created on or after this date (e.g. `2026-03-01`) |
| `to` | ISO date string | — | Filter runs created on or before this date |
| `page` | integer | `1` | Page number (1-based) |
| `limit` | integer | `20` | Runs per page |

**Response:**

```json
{
  "runs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "sopName": "ticket-screener",
      "eventSource": "freshdesk",
      "eventType": "ticket.created",
      "status": "completed",
      "triggerEvent": { "id": "...", "payload": { ... } },
      "result": { "content": "{\"classification\":\"bug\",...}" },
      "error": null,
      "tokensUsed": 847,
      "costUsd": "0.000015",
      "durationMs": 4231,
      "createdAt": "2026-04-01T10:30:00.000Z",
      "completedAt": "2026-04-01T10:30:04.231Z"
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 20
}
```

**Example:**

```bash
curl -H "Authorization: Bearer <api-key>" \
  "https://your-company-dev-admin.../admin/runs?status=failed&sop=pr-review&limit=10"
```

---

### GET /admin/runs/:id

Returns the full detail of a single run.

**Path parameter:** `id` — UUID of the run.

**Response:** A single run object (same schema as items in the `/admin/runs` array).

**Example:**

```bash
curl -H "Authorization: Bearer <api-key>" \
  "https://your-company-dev-admin.../admin/runs/550e8400-e29b-41d4-a716-446655440000"
```

---

### GET /admin/stats

Returns aggregated metrics across all stored runs.

**Response:**

```json
{
  "runsPerDay": [
    { "date": "2026-03-30", "count": 47 },
    { "date": "2026-03-31", "count": 63 },
    { "date": "2026-04-01", "count": 12 }
  ],
  "tokenUsage": [
    { "date": "2026-03-30", "tokens": 38420 },
    { "date": "2026-03-31", "tokens": 51890 }
  ],
  "errorRate": 0.023,
  "totalCostUsd": "0.842100",
  "runsBySop": [
    {
      "sop": "ticket-screener",
      "count": 89,
      "successRate": 0.978
    },
    {
      "sop": "pr-review",
      "count": 33,
      "successRate": 1.0
    }
  ]
}
```

**Field descriptions:**

| Field | Description |
|-------|-------------|
| `runsPerDay` | Run count by UTC calendar day, sorted ascending. |
| `tokenUsage` | Total token consumption (input + output) by UTC calendar day, sorted ascending. |
| `errorRate` | Fraction of all runs (across all time) that have status `failed`. |
| `totalCostUsd` | Cumulative estimated cost in USD, formatted to 6 decimal places. |
| `runsBySop` | Per-SOP breakdown with total run count and fraction of completed runs. |

**Example:**

```bash
curl -H "Authorization: Bearer <api-key>" \
  "https://your-company-dev-admin.../admin/stats" | jq '.errorRate'
```

---

### GET /admin/sops

Returns the list of SOP definitions currently loaded in the Admin service.

> Note: The Admin service and the Orchestrator load SOPs independently. If you re-seed only the Orchestrator, the Admin service may show a different SOP list until it is also restarted or re-seeded.

**Response:**

```json
{
  "sops": [
    {
      "name": "ticket-screener",
      "description": "Classifies incoming tickets by type and suggests tags and group assignments",
      "version": "1.0",
      "trigger": {
        "source": ["freshdesk", "jira", "http"],
        "type": ["ticket.created"]
      },
      "context": [...],
      "steps": [...],
      "writeback": [...],
      "guardrails": {
        "max_retries": 2,
        "timeout_seconds": 60,
        "require_human_approval": false
      }
    }
  ]
}
```

**Example:**

```bash
curl -H "Authorization: Bearer <api-key>" \
  "https://your-company-dev-admin.../admin/sops" | jq '.[0].name'
```

---

## How to Interpret Cost Tracking

The `costUsd` field on each run and the `totalCostUsd` field in stats are estimates based on Anthropic Claude Sonnet pricing:

- Input tokens: $3.00 per million
- Output tokens: $15.00 per million

Formula: `(input_tokens / 1_000_000) × 3.0 + (output_tokens / 1_000_000) × 15.0`

These figures are approximate. Actual billing depends on your contract with Anthropic or your Azure OpenAI deployment. For OpenAI models, the cost calculation uses the same formula but the per-token prices differ — treat `costUsd` as a relative measure of consumption rather than an exact billing amount when using non-Anthropic providers.

To monitor spending:
1. Check `totalCostUsd` in `/admin/stats` daily.
2. Use `/admin/runs?sop=<name>` to identify which SOPs consume the most tokens.
3. Set `max_tokens` conservatively in SOP steps to cap per-run costs.
4. Consider using a smaller/cheaper model for classification steps and a larger model only for generation steps.
