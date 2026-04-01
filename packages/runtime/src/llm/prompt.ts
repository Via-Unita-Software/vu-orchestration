import Handlebars from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { OrchestratorEvent, ContextResult } from '@vu/core';

export class PromptRenderer {
  private promptsDir: string;

  constructor(promptsDir: string) {
    this.promptsDir = promptsDir;
  }

  async render(
    promptPath: string,
    event: OrchestratorEvent,
    contextResults: Record<string, ContextResult>,
    previousStepResult?: string
  ): Promise<string> {
    const fullPath = join(this.promptsDir, promptPath);
    const template = await readFile(fullPath, 'utf-8');

    // Build template context
    const templateContext: Record<string, unknown> = {
      event: event.payload,
      meta: event.meta,
      previous_step: previousStepResult,
    };

    // Flatten context results
    for (const [key, result] of Object.entries(contextResults)) {
      templateContext[key] = result.data;
    }

    const compiled = Handlebars.compile(template);
    return compiled(templateContext);
  }
}
