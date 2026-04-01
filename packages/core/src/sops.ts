import { z } from 'zod';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const triggerSchema = z.object({
  source: z.array(z.string()),
  type: z.array(z.string()),
  filter: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

const contextEntrySchema = z.object({
  type: z.string(),
  params: z.record(z.unknown()).optional(),
});

const stepSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  model: z.string(),
  max_tokens: z.number().int().positive(),
  output_schema: z.string().optional(),
});

const writebackEntrySchema = z.object({
  type: z.string(),
  action: z.string(),
  params: z.record(z.unknown()).optional(),
});

const guardrailsSchema = z.object({
  max_retries: z.number().int().min(0).default(0),
  timeout_seconds: z.number().int().positive().default(300),
  require_human_approval: z.boolean().default(false),
});

export const sopDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  trigger: triggerSchema,
  context: z.array(contextEntrySchema).default([]),
  steps: z.array(stepSchema).min(1),
  writeback: z.array(writebackEntrySchema).default([]),
  guardrails: guardrailsSchema.default({}),
});

export type SopDefinition = z.infer<typeof sopDefinitionSchema>;
export type SopTrigger = z.infer<typeof triggerSchema>;
export type SopStep = z.infer<typeof stepSchema>;
export type WritebackEntry = z.infer<typeof writebackEntrySchema>;
export type Guardrails = z.infer<typeof guardrailsSchema>;

export async function loadSops(directory: string): Promise<SopDefinition[]> {
  const files = await readdir(directory);
  const yamlFiles = files.filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const sops: SopDefinition[] = [];
  for (const file of yamlFiles) {
    const content = await readFile(join(directory, file), 'utf-8');
    const raw = parseYaml(content);
    const sop = sopDefinitionSchema.parse(raw);
    sops.push(sop);
  }
  return sops;
}
