import type { Context } from 'hono';
import type { TriggerAdapter } from '@vu-orchestration/core';
import type { IncomingRequest } from '@vu-orchestration/core';

export async function validateWebhookSignature(
  adapterType: string,
  adapters: Map<string, TriggerAdapter>,
  req: IncomingRequest
): Promise<boolean> {
  const adapter = adapters.get(adapterType);
  if (!adapter) return false;
  return adapter.validateSignature(req);
}

export function createApiKeyMiddleware(apiKey: string) {
  return async (c: Context, next: () => Promise<void>) => {
    const auth = c.req.header('Authorization');
    if (!auth || auth !== `Bearer ${apiKey}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
