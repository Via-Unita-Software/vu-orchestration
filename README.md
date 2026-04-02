# Via Unita AI Orchestration Layer

An event-driven AI automation platform that routes webhook events from GitHub, GitLab, Freshdesk, Jira, and other sources through configurable Standard Operating Procedures (SOPs), executes LLM prompts, and writes results back to external systems — all without human intervention.

---

## Architecture

```mermaid
graph TD
    subgraph "Trigger Layer"
        GH[GitHub Webhook]
        GL[GitLab Webhook]
        FD[Freshdesk Webhook]
        JR[Jira Webhook]
        HTTP[HTTP / Generic]
        SCHED[Scheduler / Cron]
    end

    subgraph "Orchestrator (ACA)"
        ORCH[Orchestrator Service<br/>Hono HTTP server]
        DEDUP[Dedup Service<br/>Redis]
        ROUTER[SOP Router]
        QUEUE[BullMQ Queue<br/>Redis]
    end

    subgraph "Execution Layer (ACA)"
        WORKER[Runtime Worker<br/>BullMQ consumer]
        CTX[Context Loaders<br/>repo / docs / http / freshdesk / jira]
        LLM[LLM Client<br/>Anthropic / OpenAI]
        GUARD[Output Guard<br/>JSON schema validation]
    end

    subgraph "Writeback Layer"
        WB_GH[GitHub Writeback]
        WB_GL[GitLab Writeback]
        WB_FD[Freshdesk Writeback]
        WB_JR[Jira Writeback]
        WB_EM[Email Writeback]
    end

    subgraph "Observability"
        ADMIN[Admin UI / API<br/>Hono + React]
        PG[(PostgreSQL<br/>Run store)]
        KV[Azure Key Vault<br/>Secrets]
        ACR[Azure Container Registry]
    end

    GH & GL & FD & JR & HTTP & SCHED --> ORCH
    ORCH --> DEDUP --> ROUTER --> QUEUE
    QUEUE --> WORKER
    WORKER --> CTX --> LLM --> GUARD
    GUARD --> WB_GH & WB_GL & WB_FD & WB_JR & WB_EM
    WORKER --> PG
    ADMIN --> PG
    ORCH & WORKER & ADMIN --> KV
```

---

## Quick Start

```bash
# 1. Clone and install dependencies
git clone https://github.com/your-org/via-unita-orchestration.git
cd via-unita-orchestration
pnpm install

# 2. Configure your tenant
cp config/config.example.yaml config/config.yaml
# Edit config/config.yaml with your credentials and adapter settings

# 3. Deploy to Azure
./infra/scripts/deploy.sh \
  --tenant-id     your-company \
  --environment   dev \
  --location      westeurope \
  --subscription  <your-subscription-id> \
  --acr-name      yourcompanydevacr \
  --api-key       $(openssl rand -hex 32) \
  --anthropic-key sk-ant-...
```

For a complete walkthrough, see [docs/onboarding.md](docs/onboarding.md).

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Azure CLI | 2.57 | `az --version` |
| Docker Desktop | 4.x | Required for image builds |
| pnpm | 9.15 | `pnpm --version` |
| Node.js | 22 | LTS recommended |
| jq | 1.6 | Used by deploy scripts |

---

## Package Overview

| Package | Path | Description |
|---------|------|-------------|
| `@vu/core` | `packages/core` | Shared types: `OrchestratorEvent`, `SopDefinition`, `TriggerAdapter`, `WritebackAdapter`, `ContextLoader` |
| `@vu/adapters` | `packages/adapters` | Trigger adapters (GitHub, GitLab, Freshdesk, Jira, HTTP, Schedule) and writeback adapters (GitHub, GitLab, Freshdesk, Jira, Email) |
| `@vu/orchestrator` | `packages/orchestrator` | Hono HTTP server: webhook ingestion, SOP routing, BullMQ dispatch |
| `@vu/runtime` | `packages/runtime` | BullMQ worker: context loading, LLM execution, output validation, writeback |
| `@vu/admin` | `packages/admin` | Admin API (Hono) + React dashboard |

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/onboarding.md](docs/onboarding.md) | **Start here** — deploy and activate your first SOP end-to-end |
| [docs/architecture.md](docs/architecture.md) | System design, data flow, and design principles |
| [docs/sops.md](docs/sops.md) | SOP YAML authoring reference |
| [docs/adapters.md](docs/adapters.md) | Trigger and writeback adapter development guide |
| [docs/prompts.md](docs/prompts.md) | Handlebars prompt authoring and variable reference |
| [docs/admin.md](docs/admin.md) | Admin UI and API reference |
| [infra/README.md](infra/README.md) | Infrastructure (Bicep, deploy scripts, CI/CD) |

---

## Repository Layout

```
via-unita-orchestration/
├── packages/
│   ├── core/          # Shared types and schemas
│   ├── adapters/      # Trigger and writeback adapters
│   ├── orchestrator/  # HTTP server + SOP router
│   ├── runtime/       # BullMQ worker + LLM execution
│   └── admin/         # Admin UI + API
├── sops/              # SOP YAML definitions
├── prompts/           # Handlebars prompt templates
├── config/            # Tenant configuration
│   └── config.example.yaml
└── infra/             # Azure Bicep + deploy scripts
    ├── bicep/
    └── scripts/
```
