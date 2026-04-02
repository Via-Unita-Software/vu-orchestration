#!/usr/bin/env bash
# Via Unita AI Orchestration — Full Deployment Script
#
# Usage:
#   ./infra/scripts/deploy.sh [OPTIONS]
#
# Options:
#   --tenant-id      <id>     Tenant identifier (e.g. acme-software)  [required]
#   --environment    <env>    dev | staging | prod                     [default: dev]
#   --location       <region> Azure region                             [default: westeurope]
#   --subscription   <id>     Azure subscription ID                    [optional]
#   --resource-group <name>   Resource group name                      [default: <tenant>-<env>-rg]
#   --acr-name       <name>   Container registry name (globally unique)[required]
#   --api-key        <key>    API key for HTTP endpoints               [required]
#   --anthropic-key  <key>    Anthropic API key                        [required]
#   --image-tag      <tag>    Docker image tag for all images           [default: latest]
#   --skip-build              Skip Docker build & push step
#   --skip-migrate            Skip database migration step
#
# Prerequisites:
#   - Azure CLI (az) logged in  (az login)
#   - Docker daemon running
#   - pnpm installed
#   - jq installed
#   - Node.js >= 18

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve script / repo paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BICEP_DIR="${REPO_ROOT}/infra/bicep"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ENVIRONMENT="dev"
LOCATION="westeurope"
RESOURCE_GROUP=""
TENANT_ID=""
ACR_NAME=""
SUBSCRIPTION=""
API_KEY=""
ANTHROPIC_KEY=""
IMAGE_TAG="latest"
SKIP_BUILD=false
SKIP_MIGRATE=false

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --tenant-id)      TENANT_ID="$2";      shift 2 ;;
    --environment)    ENVIRONMENT="$2";    shift 2 ;;
    --location)       LOCATION="$2";       shift 2 ;;
    --subscription)   SUBSCRIPTION="$2";   shift 2 ;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --acr-name)       ACR_NAME="$2";       shift 2 ;;
    --api-key)        API_KEY="$2";        shift 2 ;;
    --anthropic-key)  ANTHROPIC_KEY="$2";  shift 2 ;;
    --image-tag)      IMAGE_TAG="$2";      shift 2 ;;
    --skip-build)     SKIP_BUILD=true;     shift ;;
    --skip-migrate)   SKIP_MIGRATE=true;   shift ;;
    -h|--help)
      sed -n '3,25p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate required arguments
# ---------------------------------------------------------------------------
errors=0
if [[ -z "$TENANT_ID" ]];    then echo "Error: --tenant-id is required"    >&2; errors=$((errors+1)); fi
if [[ -z "$ACR_NAME" ]];     then echo "Error: --acr-name is required"     >&2; errors=$((errors+1)); fi
if [[ -z "$API_KEY" ]];      then echo "Error: --api-key is required"      >&2; errors=$((errors+1)); fi
if [[ -z "$ANTHROPIC_KEY" ]]; then echo "Error: --anthropic-key is required" >&2; errors=$((errors+1)); fi
if [[ $errors -gt 0 ]]; then exit 1; fi

RESOURCE_GROUP="${RESOURCE_GROUP:-${TENANT_ID}-${ENVIRONMENT}-rg}"
APP_PREFIX="${TENANT_ID}-${ENVIRONMENT}"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo "========================================================"
echo "  Via Unita AI Orchestration — Deployment"
echo "========================================================"
echo "  Tenant:         ${TENANT_ID}"
echo "  Environment:    ${ENVIRONMENT}"
echo "  Location:       ${LOCATION}"
echo "  Resource Group: ${RESOURCE_GROUP}"
echo "  ACR Name:       ${ACR_NAME}"
echo "  Image Tag:      ${IMAGE_TAG}"
echo "========================================================"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Set Azure subscription (if provided)
# ---------------------------------------------------------------------------
if [[ -n "$SUBSCRIPTION" ]]; then
  echo "[1/7] Setting Azure subscription to '${SUBSCRIPTION}'..."
  az account set --subscription "$SUBSCRIPTION"
else
  echo "[1/7] Using current Azure subscription."
fi

# ---------------------------------------------------------------------------
# Step 2: Create resource group
# ---------------------------------------------------------------------------
echo "[2/7] Ensuring resource group '${RESOURCE_GROUP}' exists..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none
echo "      Resource group ready."

# ---------------------------------------------------------------------------
# Step 3: Deploy Bicep (infrastructure)
# ---------------------------------------------------------------------------
echo "[3/7] Deploying Bicep infrastructure (this may take 10-15 minutes)..."
DEPLOYMENT_NAME="via-unita-${ENVIRONMENT}-$(date +%Y%m%d%H%M%S)"

DEPLOYMENT_OUTPUT=$(az deployment group create \
  --name "$DEPLOYMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "${BICEP_DIR}/main.bicep" \
  --parameters \
    tenantId="$TENANT_ID" \
    environment="$ENVIRONMENT" \
    location="$LOCATION" \
    acrName="$ACR_NAME" \
    orchestratorImageTag="$IMAGE_TAG" \
    runtimeImageTag="$IMAGE_TAG" \
    adminImageTag="$IMAGE_TAG" \
    apiKey="$API_KEY" \
    anthropicApiKey="$ANTHROPIC_KEY" \
  --output json)

ACR_LOGIN_SERVER=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.acrLoginServer.value')
ORCHESTRATOR_URL=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.orchestratorUrl.value')
ADMIN_URL=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.adminUrl.value')
PG_FQDN=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.postgresServerFqdn.value')

echo "      ACR Login Server:  ${ACR_LOGIN_SERVER}"
echo "      Orchestrator URL:  ${ORCHESTRATOR_URL}"
echo "      Admin URL:         ${ADMIN_URL}"
echo "      Postgres FQDN:     ${PG_FQDN}"

# ---------------------------------------------------------------------------
# Step 4: Build Docker images
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "[4/7] Skipping Docker build (--skip-build)."
else
  echo "[4/7] Building Docker images..."
  cd "$REPO_ROOT"

  echo "      Running pnpm build..."
  pnpm build

  for pkg in orchestrator runtime admin; do
    echo "      Building ${pkg}:${IMAGE_TAG}..."
    docker build \
      -f "packages/${pkg}/Dockerfile" \
      --tag "${ACR_LOGIN_SERVER}/${pkg}:${IMAGE_TAG}" \
      --build-arg PACKAGE="$pkg" \
      .
  done
fi

# ---------------------------------------------------------------------------
# Step 5: Push images to ACR
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "[5/7] Skipping image push (--skip-build)."
else
  echo "[5/7] Pushing images to ACR '${ACR_NAME}'..."
  az acr login --name "$ACR_NAME"

  for pkg in orchestrator runtime admin; do
    echo "      Pushing ${pkg}:${IMAGE_TAG}..."
    docker push "${ACR_LOGIN_SERVER}/${pkg}:${IMAGE_TAG}"
  done
fi

# ---------------------------------------------------------------------------
# Step 6: Run database migrations
# ---------------------------------------------------------------------------
if [[ "$SKIP_MIGRATE" == "true" ]]; then
  echo "[6/7] Skipping database migration (--skip-migrate)."
else
  echo "[6/7] Running Drizzle database migrations..."
  # The orchestrator handles migrations via drizzle-kit
  DATABASE_URL="postgresql://pgadmin@${PG_FQDN}/orchestrator?sslmode=require"
  export DATABASE_URL

  cd "${REPO_ROOT}/packages/orchestrator"
  npx drizzle-kit migrate
  cd "$REPO_ROOT"
fi

# ---------------------------------------------------------------------------
# Step 7: Update Container Apps with the pushed image tag
# ---------------------------------------------------------------------------
echo "[7/7] Updating Container Apps with image tag '${IMAGE_TAG}'..."
for app in orchestrator runtime admin; do
  echo "      Updating ${APP_PREFIX}-${app}..."
  az containerapp update \
    --name "${APP_PREFIX}-${app}" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/${app}:${IMAGE_TAG}" \
    --output none
done

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "========================================================"
echo "  Deployment complete!"
echo "========================================================"
echo ""
echo "  Orchestrator: ${ORCHESTRATOR_URL}"
echo "  Admin UI:     ${ADMIN_URL}"
echo ""
echo "  Next steps:"
echo "    1. Run './infra/scripts/seed.sh' to upload SOPs, prompts, and config."
echo "    2. Configure webhooks in your source systems:"
echo "         ${ORCHESTRATOR_URL}/webhooks/<adapter-type>"
echo "    3. Open the Admin UI: ${ADMIN_URL}"
echo ""
