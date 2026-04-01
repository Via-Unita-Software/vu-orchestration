import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { tenantConfigSchema, loadConfig } from '../config.js';

const validConfig = {
  tenant: {
    id: 'example-company',
    name: 'Example Company GmbH',
  },
  ai_hub: {
    openwebui_url: 'https://aihub.example.internal',
    tool_endpoints: {
      chat: '/api/chat',
      run: '/api/run',
    },
  },
  adapters: {
    triggers: [
      {
        type: 'github',
        webhook_secret_ref: 'GITHUB_WEBHOOK_SECRET',
        base_url: 'https://api.github.com',
      },
    ],
    writebacks: [
      {
        type: 'github',
        api_token_ref: 'GITHUB_API_TOKEN',
      },
    ],
  },
  llm: {
    default_provider: 'anthropic',
    providers: {
      anthropic: {
        api_key_ref: 'ANTHROPIC_API_KEY',
      },
    },
  },
  secrets: {
    backend: 'azure_keyvault' as const,
    keyvault_url: 'https://example-ai.vault.azure.net',
  },
};

describe('tenantConfigSchema', () => {
  it('validates a complete config', () => {
    const result = tenantConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects config with missing tenant.id', () => {
    const bad = { ...validConfig, tenant: { name: 'No ID Corp' } };
    expect(() => tenantConfigSchema.parse(bad)).toThrow();
  });

  it('rejects config with invalid ai_hub URL', () => {
    const bad = {
      ...validConfig,
      ai_hub: { ...validConfig.ai_hub, openwebui_url: 'not-a-url' },
    };
    expect(() => tenantConfigSchema.parse(bad)).toThrow();
  });

  it('rejects config with missing llm.default_provider', () => {
    const bad = {
      ...validConfig,
      llm: { providers: validConfig.llm.providers },
    };
    expect(() => tenantConfigSchema.parse(bad)).toThrow();
  });

  it('rejects config with invalid secrets backend', () => {
    const bad = {
      ...validConfig,
      secrets: { backend: 'unknown_backend' },
    };
    expect(() => tenantConfigSchema.parse(bad)).toThrow();
  });

  it('accepts env as secrets backend', () => {
    const result = tenantConfigSchema.safeParse({
      ...validConfig,
      secrets: { backend: 'env' },
    });
    expect(result.success).toBe(true);
  });

  it('applies default empty arrays for adapters', () => {
    const noAdapters = {
      ...validConfig,
      adapters: {},
    };
    const result = tenantConfigSchema.parse(noAdapters);
    expect(result.adapters.triggers).toEqual([]);
    expect(result.adapters.writebacks).toEqual([]);
  });
});

describe('loadConfig', () => {
  it('loads the example config file', async () => {
    const thisFile = fileURLToPath(import.meta.url);
    // Navigate from src/__tests__/ up to the repo root config/
    const configPath = resolve(thisFile, '..', '..', '..', '..', '..', 'config', 'config.example.yaml');
    const config = await loadConfig(configPath);
    expect(config.tenant.id).toBe('example-company');
    expect(config.llm.default_provider).toBe('anthropic');
    expect(config.secrets.backend).toBe('azure_keyvault');
  });
});
