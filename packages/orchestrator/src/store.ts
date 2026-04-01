import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, uuid, text, integer, numeric, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { Pool } from 'pg';

export const runStatusEnum = pgEnum('run_status', ['queued', 'running', 'completed', 'failed']);

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sopName: text('sop_name').notNull(),
  eventSource: text('event_source').notNull(),
  eventType: text('event_type').notNull(),
  status: runStatusEnum('status').notNull().default('queued'),
  triggerEvent: jsonb('trigger_event').notNull(),
  result: jsonb('result'),
  error: text('error'),
  tokensUsed: integer('tokens_used'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ListRunsOptions {
  sopName?: string;
  status?: RunStatus;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema: { runs } });
}

export type Db = ReturnType<typeof createDb>;

export class RunStore {
  constructor(private readonly db: Db) {}

  async createRun(data: NewRun): Promise<Run> {
    const [run] = await this.db.insert(runs).values(data).returning();
    return run;
  }

  async updateRun(
    id: string,
    data: Partial<Omit<NewRun, 'id' | 'createdAt'>>
  ): Promise<Run | null> {
    const [run] = await this.db
      .update(runs)
      .set(data)
      .where(eq(runs.id, id))
      .returning();
    return run ?? null;
  }

  async getRun(id: string): Promise<Run | null> {
    const [run] = await this.db.select().from(runs).where(eq(runs.id, id));
    return run ?? null;
  }

  async listRuns(options: ListRunsOptions = {}): Promise<Run[]> {
    const { sopName, status, fromDate, toDate, limit = 50 } = options;

    const conditions = [];
    if (sopName) conditions.push(eq(runs.sopName, sopName));
    if (status) conditions.push(eq(runs.status, status));
    if (fromDate) conditions.push(gte(runs.createdAt, fromDate));
    if (toDate) conditions.push(lte(runs.createdAt, toDate));

    const query = this.db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(limit);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }
}
