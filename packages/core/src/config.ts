import { z } from 'zod';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';

const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const toolEndpointsSchema = z.object({
  chat: z.string(),
  run: z.string(),
});

const aiHubSchema = z.object({
  openwebui_url: z.string().url(),
  tool_endpoints: toolEndpointsSchema,
});

const triggerAdapterConfigSchema = z.object({
  type: z.string().min(1),
  webhook_secret_ref: z.string().optional(),
  base_url: z.string().optional(),
}).passthrough();

const writebackAdapterConfigSchema = z.object({
  type: z.string().min(1),
  api_token_ref: z.string().optional(),
  base_url: z.string().optional(),
}).passthrough();

const adaptersSchema = z.object({
  triggers: z.array(triggerAdapterConfigSchema).default([]),
  writebacks: z.array(writebackAdapterConfigSchema).default([]),
});

const llmProviderSchema = z.object({
  api_key_ref: z.string(),
  base_url: z.string().optional(),
  model: z.string().optional(),
}).passthrough();

const llmSchema = z.object({
  default_provider: z.string().min(1),
  providers: z.record(llmProviderSchema),
});

const secretsSchema = z.object({
  backend: z.enum(['azure_keyvault', 'env', 'hashicorp_vault']),
  keyvault_url: z.string().optional(),
  vault_addr: z.string().optional(),
});

export const tenantConfigSchema = z.object({
  tenant: tenantSchema,
  ai_hub: aiHubSchema,
  adapters: adaptersSchema,
  llm: llmSchema,
  secrets: secretsSchema,
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type AiHub = z.infer<typeof aiHubSchema>;
export type AdaptersConfig = z.infer<typeof adaptersSchema>;
export type LlmConfig = z.infer<typeof llmSchema>;
export type SecretsConfig = z.infer<typeof secretsSchema>;
export type TriggerAdapterConfig = z.infer<typeof triggerAdapterConfigSchema>;
export type WritebackAdapterConfig = z.infer<typeof writebackAdapterConfigSchema>;

export async function loadConfig(path: string): Promise<TenantConfig> {
  const content = await readFile(path, 'utf-8');
  const raw = parseYaml(content);
  return tenantConfigSchema.parse(raw);
}
