# Onboarding Guide

This guide takes a CTO or Tech Lead from zero to a deployed, fully operational orchestration layer with the `ticket-screener` SOP active end-to-end. Follow the steps in order. The only prerequisite is an Azure subscription.

Estimated time: **45–60 minutes** for a first deployment.

---

## Prerequisites

### Azure Subscription

You need an Azure subscription with **Contributor** access. If you do not have one, ask your Azure administrator.

```bash
# Verify you can list subscriptions
az account list --output table
```

### CLI Tools

Install the following before proceeding:

| Tool | Install | Verify |
|------|---------|--------|
| Azure CLI >= 2.57 | [docs.microsoft.com/cli/azure/install-azure-cli](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) | `az --version` |
| Docker Desktop | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) | `docker info` |
| Node.js 22 | [nodejs.org](https://nodejs.org/) | `node --version` |
| pnpm 9.15 | `npm install -g pnpm` | `pnpm --version` |
| jq | [jqlang.github.io/jq](https://jqlang.github.io/jq/download/) | `jq --version` |

### Access Requirements

- An **Anthropic API key** (or OpenAI key if you prefer)
- Write access to a **GitHub** or **Jira** project to configure a webhook (for the end-to-end test)
- An **Azure Container Registry** name (globally unique, e.g. `acmesoftwaredevacr`) — the deploy script will create it if it does not exist

---

## Step 1: Clone and Configure

### 1.1 Clone the repository

```bash
git clone https://github.com/your-org/via-unita-orchestration.git
cd via-unita-orchestration
pnpm install
```

### 1.2 Copy the example configuration

```bash
cp config/config.example.yaml config/config.yaml
```

### 1.3 Edit config/config.yaml

Open `config/config.yaml` and fill in the required values:

```yaml
tenant:
  id: your-company          # A short slug used in logs — no spaces
  name: Your Company GmbH   # Human-readable display name

ai_hub:
  openwebui_url: https://aihub.your-company.internal
  tool_endpoints:
    chat: /api/chat
    run: /api/run

adapters:
  triggers:
    - type: github
      webhook_secret_ref: GITHUB_WEBHOOK_SECRET   # Name of the secret in Key Vault
      base_url: https://api.github.com

    # Uncomment for Jira:
    # - type: jira
    #   webhook_secret_ref: JIRA_WEBHOOK_SECRET
    #   base_url: https://yourcompany.atlassian.net

  writebacks:
    - type: github
      api_token_ref: GITHUB_API_TOKEN

    # Uncomment for Freshdesk:
    # - type: freshdesk
    #   api_token_ref: FRESHDESK_API_KEY

llm:
  default_provider: anthropic
  providers:
    anthropic:
      api_key_ref: ANTHROPIC_API_KEY   # Name of the secret in Key Vault

secrets:
  backend: azure_keyvault
  keyvault_url: https://your-company-dev-kv.vault.azure.net  # filled in by deploy.sh
```

> **Important**: `webhook_secret_ref`, `api_token_ref`, and `api_key_ref` are **names** of secrets stored in Azure Key Vault, not the secret values themselves. The actual values are provided to `deploy.sh` and stored securely by the infrastructure script.

---

## Step 2: Deploy Infrastructure

### 2.1 Log in to Azure

```bash
az login
az account set --subscription <your-subscription-id>
```

### 2.2 Run deploy.sh

```bash
./infra/scripts/deploy.sh \
  --tenant-id     your-company \
  --environment   dev \
  --location      westeurope \
  --subscription  <your-subscription-id> \
  --acr-name      yourcompanydevacr \
  --api-key       $(openssl rand -hex 32) \
  --anthropic-key sk-ant-api03-...
```

**Parameter reference:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--tenant-id` | Yes | Your tenant slug (matches `tenant.id` in config.yaml). Used as the resource name prefix. |
| `--environment` | Yes | `dev`, `staging`, or `prod`. Controls resource sizing and Key Vault soft-delete period. |
| `--location` | Yes | Azure region, e.g. `westeurope`, `eastus`. |
| `--subscription` | Yes | Azure subscription ID or name. |
| `--acr-name` | Yes | Container Registry name — globally unique across all Azure customers. |
| `--api-key` | Yes | Bearer token for the `/api/*` and `/admin/*` endpoints. Generate with `openssl rand -hex 32`. Store this value — you will need it later. |
| `--anthropic-key` | Yes | Anthropic API key. Stored in Key Vault, never in the image or config file. |
| `--image-tag` | No | Image tag to use instead of `latest`. Pass `$GITHUB_SHA` in CI. |
| `--skip-build` | No | Skip Docker build/push (assumes images already in ACR). |
| `--skip-migrate` | No | Skip Drizzle database migration step. |

**What the script does:**

1. Creates the resource group `your-company-dev-rg` in the specified region.
2. Deploys Key Vault, Redis (Basic C0), PostgreSQL (Burstable B1ms), and the Container Apps environment via Bicep.
3. Stores your API key and Anthropic key as Key Vault secrets.
4. Runs `pnpm build` and builds three Docker images: `orchestrator`, `runtime`, `admin`.
5. Pushes images to ACR.
6. Runs Drizzle database migrations against PostgreSQL.
7. Updates the three Container Apps to the new images.
8. Prints the `orchestratorUrl` and `adminUrl` at the end.

**Save the output URLs** — you will need them in the steps below.

```
orchestratorUrl: https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io
adminUrl:        https://your-company-dev-admin.westeurope.azurecontainerapps.io
```

### 2.3 Verify the deployment

```bash
curl https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io/health
# Expected: {"status":"ok","timestamp":"..."}
```

---

## Step 3: Seed SOPs and Prompts

The `seed.sh` script uploads your local `sops/`, `prompts/`, and `config/config.yaml` into the running containers.

```bash
./infra/scripts/seed.sh \
  --tenant-id   your-company \
  --environment dev \
  --config-file config/config.yaml
```

> **Note**: Files uploaded by `seed.sh` live in-memory and are lost on container restart. For production, bake files into the Docker image during your CI/CD pipeline, or mount an Azure Files share as a volume. See `infra/README.md` for details.

Verify SOPs loaded:

```bash
curl -H "Authorization: Bearer <your-api-key>" \
  https://your-company-dev-admin.westeurope.azurecontainerapps.io/admin/sops
# Expected: {"sops":[{"name":"ticket-screener",...}, ...]}
```

---

## Step 4: Configure Webhooks

### GitHub Webhook

1. Go to your GitHub repository > **Settings** > **Webhooks** > **Add webhook**.
2. Set **Payload URL** to:
   ```
   https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io/webhooks/github
   ```
3. Set **Content type** to `application/json`.
4. Set **Secret** to a random string, e.g.:
   ```bash
   openssl rand -hex 32
   ```
   Copy this value — it is your `GITHUB_WEBHOOK_SECRET`.
5. Select **Individual events**: `Pull requests`, `Issues`, `Push`.
6. Click **Add webhook**.

Now store the webhook secret in Key Vault so the Orchestrator can validate signatures:

```bash
az keyvault secret set \
  --vault-name your-company-dev-kv \
  --name GITHUB-WEBHOOK-SECRET \
  --value "<the secret you generated>"
```

> The Key Vault secret name uses hyphens. The config `webhook_secret_ref` value uses underscores (`GITHUB_WEBHOOK_SECRET`) — the runtime normalises these automatically.

### Jira Webhook

1. Go to **Jira** > **System** > **WebHooks** > **Create a WebHook**.
2. Set **URL** to:
   ```
   https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io/webhooks/jira
   ```
3. Under **Issue**, select `created` and `updated`.
4. Set a **Shared secret** and store it in Key Vault:
   ```bash
   az keyvault secret set \
     --vault-name your-company-dev-kv \
     --name JIRA-WEBHOOK-SECRET \
     --value "<your-shared-secret>"
   ```
5. Jira sends the secret in the `x-atlassian-secret` header, which the Jira adapter validates.

---

## Step 5: Activate Your First SOP (ticket-screener)

The `ticket-screener` SOP is already included in the `sops/` directory. It classifies incoming support tickets and writes tags and group assignments back to Freshdesk.

### 5.1 Store Freshdesk credentials in Key Vault

```bash
# Your Freshdesk domain, e.g. yourcompany.freshdesk.com
az keyvault secret set \
  --vault-name your-company-dev-kv \
  --name FRESHDESK-URL \
  --value "https://yourcompany.freshdesk.com"

az keyvault secret set \
  --vault-name your-company-dev-kv \
  --name FRESHDESK-API-KEY \
  --value "<your-freshdesk-api-key>"
```

### 5.2 Configure the Freshdesk webhook

In Freshdesk, go to **Admin** > **Automations** > **New Automation Rule** and add a webhook action that fires on ticket creation:

- **Webhook URL**: `https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io/webhooks/freshdesk`
- **Request type**: POST
- **Content**: JSON — send the full ticket payload

> Freshdesk uses IP whitelisting rather than HMAC signatures by default. If you want header-based validation, set a `secret` in the Freshdesk adapter config and send it in the `x-freshdesk-secret` header.

### 5.3 Trigger a test event

Create a new ticket in Freshdesk. Within a few seconds, check the Admin UI:

```bash
open https://your-company-dev-admin.westeurope.azurecontainerapps.io
```

Or query the API:

```bash
curl -H "Authorization: Bearer <your-api-key>" \
  "https://your-company-dev-admin.westeurope.azurecontainerapps.io/admin/runs?limit=5"
```

You should see a run with `status: completed`, `sopName: ticket-screener`, and a `result` containing the classification JSON.

### 5.4 Verify writeback

In Freshdesk, open the ticket you created. It should now have tags and a group assignment added by the AI.

---

## Step 6: Connect the AI Hub (OpenWebUI)

The Orchestrator exposes `/api/chat` for synchronous, interactive invocations. You can register this as an HTTP tool in OpenWebUI so your team can trigger SOPs from the chat interface.

### 6.1 Add the Orchestrator as an OpenWebUI tool

In OpenWebUI, go to **Admin** > **Tools** > **Add Tool** (or your organisation's equivalent), and configure:

- **Name**: Via Unita Orchestrator
- **Base URL**: `https://your-company-dev-orchestrator.westeurope.azurecontainerapps.io`
- **Endpoint**: `/api/chat`
- **Method**: POST
- **Headers**:
  ```
  Authorization: Bearer <your-api-key>
  Content-Type: application/json
  ```
- **Body schema**:
  ```json
  {
    "event": {
      "source": "openwebui",
      "sourceEventId": "{{session_id}}",
      "type": "chat.query",
      "payload": {
        "query": "{{user_message}}",
        "user_id": "{{user_id}}"
      },
      "meta": {
        "tenant": "your-company",
        "deduplicationKey": "{{session_id}}",
        "interactive": true
      }
    },
    "timeoutMs": 30000
  }
  ```

The `POST /api/chat` endpoint polls for completion and returns the result inline, so OpenWebUI receives the AI response synchronously.

### 6.2 Create an OpenWebUI SOP

Create `sops/chat-assistant.yaml` to handle `openwebui` events:

```yaml
name: chat-assistant
description: General-purpose Q&A via the AI Hub
version: "1.0"

trigger:
  source:
    - openwebui
    - http
  type:
    - chat.query

steps:
  - name: answer
    prompt: prompts/chat-assistant/answer.md
    model: claude-sonnet-4-20250514
    max_tokens: 2048

guardrails:
  timeout_seconds: 25
```

Re-seed after adding the new SOP:

```bash
./infra/scripts/seed.sh --tenant-id your-company --environment dev --config-file config/config.yaml
```

---

## Troubleshooting

### Redis connection failures

**Symptom**: Worker logs show `Error: connect ECONNREFUSED` or jobs stay in `queued` indefinitely.

**Check**:
```bash
# View worker logs in ACA
az containerapp logs show \
  --name your-company-dev-runtime \
  --resource-group your-company-dev-rg \
  --follow
```

**Common cause**: The `REDIS_HOST` / `REDIS_PASSWORD` environment variables are not set on the worker Container App. These are injected from ACA secrets during deployment. Run `deploy.sh` again if secrets are missing.

### Database migration failures

**Symptom**: `deploy.sh` fails with `relation "runs" does not exist` or similar.

**Fix**: Run the migration step manually:
```bash
./infra/scripts/deploy.sh \
  --tenant-id your-company \
  --environment dev \
  --skip-build \
  --subscription <subscription-id> \
  --acr-name yourcompanydevacr \
  --api-key <key> \
  --anthropic-key <key>
```

Or run the Drizzle migration directly:
```bash
DATABASE_URL="postgresql://..." pnpm --filter @vu/orchestrator db:migrate
```

### Webhook signature failures

**Symptom**: Webhooks return HTTP 401 with `{"error":"Invalid signature"}`.

**GitHub**: Verify the secret stored in Key Vault (`GITHUB-WEBHOOK-SECRET`) exactly matches the secret entered in the GitHub webhook settings. The comparison is case-sensitive and includes no whitespace.

```bash
# Check what's stored
az keyvault secret show \
  --vault-name your-company-dev-kv \
  --name GITHUB-WEBHOOK-SECRET \
  --query value -o tsv
```

**Jira**: Verify the `x-atlassian-secret` header is being sent by Jira and matches `JIRA-WEBHOOK-SECRET` in Key Vault.

**Freshdesk**: If you have not configured a secret, ensure the Freshdesk adapter config in `config.yaml` does not have a `webhook_secret_ref` set. Freshdesk uses IP whitelisting by default and the adapter will accept all requests when no secret is configured.

### No SOP matched

**Symptom**: Webhooks return HTTP 202 with `{"status":"no_match"}`.

**Check**: The SOP's `trigger.source` must match the adapter type exactly (e.g. `github`, not `GitHub`). The `trigger.type` must match the normalized event type produced by that adapter. See [docs/adapters.md](adapters.md) for the full list of event types per adapter.

Use the admin API to confirm which SOPs are loaded:
```bash
curl -H "Authorization: Bearer <api-key>" \
  https://.../admin/sops | jq '.[].trigger'
```

### Container Apps not starting

**Symptom**: Container Apps show `Provisioning failed` in the Azure portal.

**Check**: The managed identity may lack the `AcrPull` role on the ACR. This is assigned by `deploy.sh`, but confirm:

```bash
az role assignment list \
  --scope $(az acr show --name yourcompanydevacr --query id -o tsv) \
  --query "[].{role:roleDefinitionName, principal:principalName}"
```

---

## Next Steps

- Read [docs/sops.md](sops.md) to learn the full SOP YAML field reference and how to author your own SOPs.
- Read [docs/adapters.md](adapters.md) to understand how to extend the system with new trigger or writeback adapters.
- Read [docs/prompts.md](prompts.md) for the complete Handlebars variable reference.
- Read [docs/admin.md](admin.md) for the Admin UI and API reference.
- Review `sops/pr-review.yaml` and `sops/weekly-digest.yaml` for more SOP examples.
