import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu-orchestration/core';

export class WritebackAdapterRegistry {
  private adapters = new Map<string, WritebackAdapter>();

  register(adapter: WritebackAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): WritebackAdapter | undefined {
    return this.adapters.get(type);
  }

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const adapter = this.adapters.get(action.type);
    if (!adapter) {
      return { success: false, error: `No adapter registered for type: ${action.type}` };
    }

    if (!adapter.allowedActions.includes(action.action)) {
      return {
        success: false,
        error: `Action '${action.action}' not allowed for adapter '${action.type}'. Allowed: ${adapter.allowedActions.join(', ')}`,
      };
    }

    return adapter.execute(action);
  }
}
