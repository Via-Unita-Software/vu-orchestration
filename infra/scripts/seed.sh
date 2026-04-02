#!/usr/bin/env bash
# Via Unita AI Orchestration — Config & SOP Seeding Script
#
# Copies SOPs, prompts, and config.yaml into the running orchestrator and
# runtime Container Apps via 'az containerapp exec'.
#
# NOTE: For production environments, prefer one of these alternatives instead:
#   - Bake SOPs/prompts into the Docker image during CI/CD
#   - Mount an Azure Files share as a volume in the ACA environment
# This script is provided for convenience in dev/staging or for hot-updates.
#
# Usage:
#   ./infra/scripts/seed.sh [OPTIONS]
#
# Options:
#   --tenant-id      <id>    Tenant identifier                        [required]
#   --environment    <env>   dev | staging | prod                     [default: dev]
#   --resource-group <name>  Resource group name                      [default: <tenant>-<env>-rg]
#   --config-file    <path>  Path to config.yaml                      [default: config/config.yaml]
#   --sops-dir       <path>  Directory containing SOP YAML files      [default: sops/]
#   --prompts-dir    <path>  Directory containing prompt files        [default: prompts/]
#
# Prerequisites:
#   - Azure CLI (az) logged in
#   - Sufficient RBAC permissions to exec into Container Apps

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ENVIRONMENT="dev"
TENANT_ID=""
RESOURCE_GROUP=""
CONFIG_FILE="${REPO_ROOT}/config/config.yaml"
SOPS_DIR="${REPO_ROOT}/sops"
PROMPTS_DIR="${REPO_ROOT}/prompts"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --tenant-id)      TENANT_ID="$2";      shift 2 ;;
    --environment)    ENVIRONMENT="$2";    shift 2 ;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --config-file)    CONFIG_FILE="$2";    shift 2 ;;
    --sops-dir)       SOPS_DIR="$2";       shift 2 ;;
    --prompts-dir)    PROMPTS_DIR="$2";    shift 2 ;;
    -h|--help)
      sed -n '3,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
if [[ -z "$TENANT_ID" ]]; then
  echo "Error: --tenant-id is required" >&2
  exit 1
fi

RESOURCE_GROUP="${RESOURCE_GROUP:-${TENANT_ID}-${ENVIRONMENT}-rg}"
ORCHESTRATOR_APP="${TENANT_ID}-${ENVIRONMENT}-orchestrator"
RUNTIME_APP="${TENANT_ID}-${ENVIRONMENT}-runtime"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: config file not found at '${CONFIG_FILE}'" >&2
  echo "       Copy config/config.example.yaml to ${CONFIG_FILE} and fill in your values." >&2
  exit 1
fi

if [[ ! -d "$SOPS_DIR" ]]; then
  echo "Error: SOPs directory not found at '${SOPS_DIR}'" >&2
  exit 1
fi

if [[ ! -d "$PROMPTS_DIR" ]]; then
  echo "Error: Prompts directory not found at '${PROMPTS_DIR}'" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo "========================================================"
echo "  Via Unita AI Orchestration — Seed"
echo "========================================================"
echo "  Tenant:         ${TENANT_ID}"
echo "  Environment:    ${ENVIRONMENT}"
echo "  Resource Group: ${RESOURCE_GROUP}"
echo "  Config:         ${CONFIG_FILE}"
echo "  SOPs dir:       ${SOPS_DIR}"
echo "  Prompts dir:    ${PROMPTS_DIR}"
echo "========================================================"
echo ""

# ---------------------------------------------------------------------------
# Helper: upload a single local file to a container app via exec + stdin
# ---------------------------------------------------------------------------
upload_file() {
  local app_name="$1"
  local resource_group="$2"
  local local_path="$3"
  local remote_path="$4"

  # Create parent directory if needed
  local remote_dir
  remote_dir="$(dirname "$remote_path")"
  az containerapp exec \
    --name "$app_name" \
    --resource-group "$resource_group" \
    --command "mkdir -p ${remote_dir}" \
    --output none 2>/dev/null || true

  # Stream file content via stdin
  az containerapp exec \
    --name "$app_name" \
    --resource-group "$resource_group" \
    --command "cat > ${remote_path}" \
    --stdin "$local_path" \
    --output none
}

# ---------------------------------------------------------------------------
# Helper: upload all files from a local directory into a container app
# ---------------------------------------------------------------------------
upload_directory() {
  local app_name="$1"
  local resource_group="$2"
  local local_dir="$3"
  local remote_dir="$4"

  while IFS= read -r -d '' local_file; do
    local relative_path
    relative_path="${local_file#"${local_dir}/"}"
    local remote_file="${remote_dir}/${relative_path}"
    echo "      ${local_file} -> ${remote_file}"
    upload_file "$app_name" "$resource_group" "$local_file" "$remote_file"
  done < <(find "$local_dir" -type f \
    ! -name '_template.yaml' \
    ! -name '*.example.*' \
    -print0)
}

# ---------------------------------------------------------------------------
# Seed orchestrator
# ---------------------------------------------------------------------------
echo "Seeding orchestrator app (${ORCHESTRATOR_APP})..."

echo "  Uploading config.yaml..."
upload_file "$ORCHESTRATOR_APP" "$RESOURCE_GROUP" \
  "$CONFIG_FILE" "/app/config/config.yaml"

echo "  Uploading SOPs..."
upload_directory "$ORCHESTRATOR_APP" "$RESOURCE_GROUP" \
  "$SOPS_DIR" "/app/sops"

echo "  Uploading prompts..."
upload_directory "$ORCHESTRATOR_APP" "$RESOURCE_GROUP" \
  "$PROMPTS_DIR" "/app/prompts"

echo "  Orchestrator seeded."
echo ""

# ---------------------------------------------------------------------------
# Seed runtime worker
# ---------------------------------------------------------------------------
echo "Seeding runtime app (${RUNTIME_APP})..."

echo "  Uploading config.yaml..."
upload_file "$RUNTIME_APP" "$RESOURCE_GROUP" \
  "$CONFIG_FILE" "/app/config/config.yaml"

echo "  Uploading SOPs..."
upload_directory "$RUNTIME_APP" "$RESOURCE_GROUP" \
  "$SOPS_DIR" "/app/sops"

echo "  Uploading prompts..."
upload_directory "$RUNTIME_APP" "$RESOURCE_GROUP" \
  "$PROMPTS_DIR" "/app/prompts"

echo "  Runtime seeded."
echo ""

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo "========================================================"
echo "  Seeding complete!"
echo "========================================================"
echo ""
echo "  Notes:"
echo "    - Files uploaded are in-memory and will be lost on container restart."
echo "    - For durable seeding, bake files into the Docker image (recommended)"
echo "      or mount an Azure Files share as a volume in your ACA environment."
echo ""
