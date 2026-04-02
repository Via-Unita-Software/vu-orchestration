import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu-orchestration/core';

export class ContextLoaderRegistry {
  private loaders = new Map<string, ContextLoader>();

  register(loader: ContextLoader): void {
    this.loaders.set(loader.type, loader);
  }

  get(type: string): ContextLoader | undefined {
    return this.loaders.get(type);
  }

  async loadAll(
    contextDefs: Array<{ type: string; params?: Record<string, unknown> }>,
    event: OrchestratorEvent
  ): Promise<Record<string, ContextResult>> {
    const results: Record<string, ContextResult> = {};
    for (const def of contextDefs) {
      const loader = this.loaders.get(def.type);
      if (!loader) {
        console.warn(`No loader registered for type: ${def.type}`);
        continue;
      }
      results[def.type] = await loader.load(def.params ?? {}, event);
    }
    return results;
  }
}
