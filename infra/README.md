# Via Unita AI Orchestration — Infrastructure

Azure Bicep templates and deployment scripts for the Via Unita AI Orchestration Layer.

## Directory layout

```
infra/
├── bicep/
│   ├── main.bicep        # Entry point — orchestrates the four modules
│   ├── aca.bicep         # Container Apps environment, ACR, and three apps
│   ├── redis.bicep       # Azure Cache for Redis
│   ├── postgres.bicep    # Azure Database for PostgreSQL Flexible Server
│   └── keyvault.bicep    # Key Vault + User-Assigned Managed Identity
└── scripts/
    ├── deploy.sh         # Full deployment (infra + build + push + migrate)
    └── seed.sh           # Upload SOPs, prompts, and config into running apps
```

## Architecture overview

| Resource | Dev / Staging | Production |
|---|---|---|
| Redis | Basic C0 | Standard C1 |
| PostgreSQL | Burstable B1ms, 32 GB | GeneralPurpose D2ds_v4, 128 GB, ZoneRedundant HA |
| Key Vault | Standard, 7-day soft-delete | Premium, 90-day soft-delete |
| ACR | Basic | Standard |
| Orchestrator | 0.5 vCPU / 1 GiB, 1–3 replicas (HTTP-scaled) | same |
| Runtime worker | 1 vCPU / 2 GiB, 0–10 replicas (KEDA redis-lists) | same |
| Admin UI | 0.25 vCPU / 0.5 GiB, 1–2 replicas | same |

All three Container Apps use a single **User-Assigned Managed Identity** to:
- Pull images from ACR (AcrPull role)
- Read secrets from Key Vault (Key Vault Secrets User role)

Redis credentials are stored as ACA secrets and injected as `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` environment variables. The full `rediss://` connection string is also stored as a secret for the KEDA scaler.

## Prerequisites

- Azure CLI >= 2.57 (`az --version`)
- Azure Bicep CLI (installed automatically by `az bicep install`)
- Docker Desktop (for `deploy.sh` image build/push)
- pnpm (for the monorepo build step)
- jq (for parsing deployment output)
- An Azure subscription with Contributor access

## Quick start

### 1. Log in to Azure

```bash
az login
az account set --subscription <your-subscription-id>
```

### 2. Deploy infrastructure, build images, and run migrations

```bash
./infra/scripts/deploy.sh \
  --tenant-id     acme-software \
  --environment   dev \
  --location      westeurope \
  --subscription  <subscription-id> \
  --acr-name      acmesoftwaredevacr \
  --api-key       $(openssl rand -hex 32) \
  --anthropic-key sk-ant-...
```

The script will:
1. Create the resource group
2. Deploy all Bicep modules (Key Vault, Redis, PostgreSQL, ACA)
3. Build Docker images with `pnpm build` + `docker build`
4. Push images to ACR
5. Run Drizzle database migrations
6. Update Container Apps to the new image

Optional flags:
- `--image-tag <tag>` — use a specific image tag instead of `latest`
- `--skip-build` — skip Docker build & push (assumes images already exist in ACR)
- `--skip-migrate` — skip the Drizzle migration step

### 3. Seed configuration, SOPs, and prompts

```bash
./infra/scripts/seed.sh \
  --tenant-id   acme-software \
  --environment dev \
  --config-file config/config.yaml
```

> **Note**: Files uploaded by `seed.sh` are in-memory and are lost when containers restart. For durable storage, bake files into the Docker image during CI/CD (recommended), or mount an Azure Files share as a volume.

## Deploying to multiple environments

Run `deploy.sh` once per environment with the appropriate `--environment` flag. Each environment gets its own resource group (e.g. `acme-software-dev-rg`, `acme-software-prod-rg`) and a separate set of all resources.

```bash
# Staging
./infra/scripts/deploy.sh --tenant-id acme-software --environment staging ...

# Production
./infra/scripts/deploy.sh --tenant-id acme-software --environment prod ...
```

## Bicep module reference

### `main.bicep` parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `environment` | string | `dev` | `dev`, `staging`, or `prod` |
| `location` | string | resource group location | Azure region |
| `tenantId` | string | — | Tenant identifier, used as resource name prefix |
| `acrName` | string | — | Container Registry name (globally unique) |
| `orchestratorImageTag` | string | `latest` | Orchestrator image tag |
| `runtimeImageTag` | string | `latest` | Runtime worker image tag |
| `adminImageTag` | string | `latest` | Admin UI image tag |
| `apiKey` | securestring | — | API key for orchestrator & admin endpoints |
| `anthropicApiKey` | securestring | — | Anthropic API key |
| `postgresAdminPassword` | securestring | `newGuid()` | PostgreSQL admin password |

### Outputs

| Output | Description |
|---|---|
| `orchestratorUrl` | Public HTTPS URL of the orchestrator |
| `adminUrl` | Public HTTPS URL of the admin UI |
| `keyVaultUri` | URI of the Key Vault |
| `postgresServerFqdn` | FQDN of the PostgreSQL server |
| `acrLoginServer` | Login server of the Container Registry |
| `acaEnvironmentId` | Resource ID of the ACA managed environment |

## CI/CD integration

In a CI/CD pipeline, pass sensitive values via environment variables or a secrets manager rather than command-line arguments:

```yaml
# Example GitHub Actions step
- name: Deploy
  env:
    API_KEY: ${{ secrets.API_KEY }}
    ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    ./infra/scripts/deploy.sh \
      --tenant-id   ${{ vars.TENANT_ID }} \
      --environment ${{ vars.ENVIRONMENT }} \
      --acr-name    ${{ vars.ACR_NAME }} \
      --api-key     "$API_KEY" \
      --anthropic-key "$ANTHROPIC_KEY" \
      --image-tag   ${{ github.sha }}
```
