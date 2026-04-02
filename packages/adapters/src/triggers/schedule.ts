import cron from 'node-cron';
import { createEvent } from '@vu-orchestration/core';
import type { OrchestratorEvent } from '@vu-orchestration/core';

export interface CronDefinition {
  name: string;
  schedule: string; // cron expression
  emit_event_type: string;
}

export interface ScheduleAdapterConfig {
  tenant: string;
  cronDefinitions: CronDefinition[];
}

export class ScheduleTriggerAdapter {
  type = 'schedule';
  private tasks: cron.ScheduledTask[] = [];

  constructor(private config: ScheduleAdapterConfig) {}

  start(onEvent: (event: OrchestratorEvent) => Promise<void>): void {
    for (const def of this.config.cronDefinitions) {
      const task = cron.schedule(def.schedule, async () => {
        const event = createEvent({
          source: 'schedule',
          sourceEventId: `${def.name}:${Date.now()}`,
          type: def.emit_event_type,
          payload: { schedule_name: def.name },
          meta: {
            tenant: this.config.tenant,
            deduplicationKey: `schedule:${def.name}:${Math.floor(Date.now() / 60000)}`,
            interactive: false,
          },
        });
        await onEvent(event);
      });
      this.tasks.push(task);
    }
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }
}
