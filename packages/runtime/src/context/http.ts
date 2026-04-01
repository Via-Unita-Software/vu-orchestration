import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu/core';

export class HttpContextLoader implements ContextLoader {
  type = 'http';

  async load(params: Record<string, unknown>, _event: OrchestratorEvent): Promise<ContextResult> {
    const url = params['url'] as string;
    const method = (params['method'] as string) || 'GET';
    const headers = (params['headers'] as Record<string, string>) || {};

    if (!url) throw new Error('HTTP context loader requires params.url');

    const response = await fetch(url, { method, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json')
      ? await response.json()
      : await response.text();

    return { type: 'http', data: { url, response: data } };
  }
}
