import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { TenantConfig } from '@vu-orchestration/core';
import { ContextLoaderRegistry } from './context/loader.js';
import { WritebackAdapterRegistry } from './writeback/registry.js';
import { PromptRenderer } from './llm/prompt.js';
import { validateOutput } from './llm/guard.js';
import { createLLMClient } from './llm/client.js';

// Import queue types from subpath to avoid pulling in the Hono server entry point
import type { RunJobData } from '@vu-orchestration/orchestrator/queue';
import { QUEUE_NAME } from '@vu-orchestration/orchestrator/queue';
import type { RunStore } from '@vu-orchestration/orchestrator/store';

export type { RunJobData } from '@vu-orchestration/orchestrator/queue';
export type { RunStore } from '@vu-orchestration/orchestrator/store';

export interface WorkerDeps {
  redis: Redis;
  runStore: RunStore;
  contextRegistry: ContextLoaderRegistry;
  writebackRegistry: WritebackAdapterRegistry;
  promptRenderer: PromptRenderer;
  config: TenantConfig;
}

export function createWorker(deps: WorkerDeps): Worker {
  const { redis, runStore, contextRegistry, writebackRegistry, promptRenderer, config } = deps;

  const worker = new Worker<RunJobData>(
    QUEUE_NAME,
    async (job: Job<RunJobData>) => {
      const { runId, event, sop } = job.data;
      const startTime = Date.now();

      await runStore.updateRun(runId, { status: 'running' });

      const timeoutMs = (sop.guardrails.timeout_seconds || 300) * 1000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Run timed out after ${sop.guardrails.timeout_seconds}s`)
            ),
          timeoutMs
        )
      );

      try {
        await Promise.race([processRun(job.data), timeoutPromise]);
        const durationMs = Date.now() - startTime;
        await runStore.updateRun(runId, { status: 'completed', durationMs });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await runStore.updateRun(runId, {
          status: 'failed',
          error: errorMessage,
          durationMs: Date.now() - startTime,
        });
        throw error; // BullMQ will handle retries
      }
    },
    { connection: redis as never }
  );

  async function processRun(jobData: RunJobData): Promise<void> {
    const { runId, event, sop } = jobData;

    // Load context
    const contextResults = await contextRegistry.loadAll(
      sop.context.map((c) => ({ type: c.type, params: c.params })),
      event
    );

    // Execute steps
    let previousStepResult: string | undefined;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let lastResult = '';

    for (const step of sop.steps) {
      // Render prompt
      const prompt = await promptRenderer.render(
        step.prompt,
        event,
        contextResults,
        previousStepResult
      );

      // Create LLM client
      const llmClient = createLLMClient(step.model, {
        default_provider: config.llm.default_provider,
        providers: config.llm.providers as Record<
          string,
          { api_key?: string; endpoint?: string }
        >,
      });

      // Call LLM with retry on schema validation failure
      let llmResponse;
      const maxRetries = sop.guardrails.max_retries || 0;
      let lastError: string | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
          { role: 'user', content: prompt },
        ];
        if (lastError) {
          messages.push({ role: 'assistant', content: previousStepResult || '' });
          messages.push({
            role: 'user',
            content: `Your previous response failed validation: ${lastError}. Please fix and return valid JSON.`,
          });
        }

        llmResponse = await llmClient.complete({
          model: step.model,
          messages,
          max_tokens: step.max_tokens,
        });

        totalTokensInput += llmResponse.tokens_input;
        totalTokensOutput += llmResponse.tokens_output;

        // Validate output if schema defined
        if (step.output_schema) {
          const guardResult = validateOutput(llmResponse, { type: 'object' });
          if (!guardResult.valid) {
            lastError = guardResult.errors?.join(', ');
            if (attempt >= maxRetries) {
              throw new Error(
                `Output validation failed after ${attempt + 1} attempts: ${lastError}`
              );
            }
            continue;
          }
        }

        lastError = undefined;
        break;
      }

      lastResult = llmResponse!.content;
      previousStepResult = lastResult;
    }

    // Estimate cost (rough Anthropic pricing)
    const costUsd = (
      (totalTokensInput / 1_000_000) * 3.0 +
      (totalTokensOutput / 1_000_000) * 15.0
    ).toFixed(6);

    await runStore.updateRun(runId, {
      result: { content: lastResult },
      tokensUsed: totalTokensInput + totalTokensOutput,
      costUsd,
    });

    // Execute writebacks
    for (const wb of sop.writeback) {
      await writebackRegistry.execute({
        type: wb.type,
        action: wb.action,
        params: { ...(wb.params ?? {}), result: lastResult, event },
      });
    }
  }

  return worker;
}
