import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Pool } from 'pg';
import { loadSops } from '@vu/core';
import { RunStore, createDb } from '@vu/orchestrator/store';
import { createAdminApp } from './api.js';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/viaunita';
  const sopsDir = process.env['SOPS_DIR'] ?? 'sops/';
  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  const apiKey = process.env['API_KEY'] ?? 'admin-secret';

  console.log(`[admin] Loading SOPs from ${sopsDir}`);
  const sops = await loadSops(sopsDir);
  console.log(`[admin] Loaded ${sops.length} SOPs`);

  console.log(`[admin] Connecting to PostgreSQL`);
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb(pool);
  const runStore = new RunStore(db);

  const adminApp = createAdminApp({ runStore, sops, apiKey });

  // Serve static React files for anything not matching /admin/
  adminApp.use('/*', serveStatic({ root: './dist/ui' }));

  const server = serve({ fetch: adminApp.fetch, port }, (info) => {
    console.log(`[admin] Server running on http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    console.log('[admin] Shutting down...');
    await pool.end();
    server.close(() => {
      console.log('[admin] Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[admin] Fatal error:', err);
  process.exit(1);
});
