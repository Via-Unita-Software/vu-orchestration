import { Queue } from 'bullmq';
import type { OrchestratorEvent, SopDefinition } from '@vu/core';
import type { Redis } from 'ioredis';

export const QUEUE_NAME = 'orchestrator:runs';

export interface RunJobData {
  runId: string;
  event: OrchestratorEvent;
  sop: SopDefinition;
  configPath: string;
}

export class RunQueue {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue(QUEUE_NAME, { connection: redis as any });
  }

  async dispatch(data: RunJobData): Promise<string> {
    const job = await this.queue.add('run', data, {
      jobId: data.runId,
      attempts: data.sop.guardrails.max_retries + 1,
      backoff: { type: 'exponential', delay: 2000 },
    });
    return job.id!;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
