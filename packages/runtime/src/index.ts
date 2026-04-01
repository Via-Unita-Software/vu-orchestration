import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { loadConfig } from '@vu/core';
import { createDb } from '@vu/orchestrator/store';
import { RunStore } from '@vu/orchestrator/store';
import { ContextLoaderRegistry } from './context/loader.js';
import { RepoContextLoader } from './context/repo.js';
import { DocsContextLoader } from './context/docs.js';
import { HttpContextLoader } from './context/http.js';
import { FreshdeskContextLoader } from './context/freshdesk.js';
import { JiraContextLoader } from './context/jira.js';
import { WritebackAdapterRegistry } from './writeback/registry.js';
import { PromptRenderer } from './llm/prompt.js';
import { createWorker } from './worker.js';

async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/viaunita';
  const configPath = process.env['CONFIG_PATH'] ?? 'config/config.yaml';
  const promptsDir = process.env['PROMPTS_DIR'] ?? 'prompts';

  console.log('[runtime] Loading config from', configPath);
  const config = await loadConfig(configPath);

  console.log('[runtime] Connecting to Redis at', redisUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  console.log('[runtime] Connecting to PostgreSQL');
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb(pool);
  const runStore = new RunStore(db);

  // Register context loaders
  const contextRegistry = new ContextLoaderRegistry();
  contextRegistry.register(new RepoContextLoader());
  contextRegistry.register(new DocsContextLoader());
  contextRegistry.register(new HttpContextLoader());
  contextRegistry.register(new FreshdeskContextLoader());
  contextRegistry.register(new JiraContextLoader());

  // Register writeback adapters (none built-in; extend externally)
  const writebackRegistry = new WritebackAdapterRegistry();

  const promptRenderer = new PromptRenderer(promptsDir);

  const worker = createWorker({
    redis,
    runStore,
    contextRegistry,
    writebackRegistry,
    promptRenderer,
    config,
  });

  console.log('[runtime] Runtime worker started');

  const shutdown = async (): Promise<void> => {
    console.log('[runtime] Shutting down...');
    await worker.close();
    await redis.quit();
    await pool.end();
    console.log('[runtime] Worker closed.');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[runtime] Fatal error:', err);
  process.exit(1);
});
