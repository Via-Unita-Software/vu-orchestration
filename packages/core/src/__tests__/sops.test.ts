import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { sopDefinitionSchema, loadSops } from '../sops.js';

const validSop = {
  name: 'pr-review',
  description: 'Automated PR review SOP',
  version: '1.0.0',
  trigger: {
    source: ['github'],
    type: ['pull_request.opened', 'pull_request.synchronize'],
    filter: { action: ['opened', 'synchronize'] },
  },
  context: [
    { type: 'github_pr', params: { include_diff: true } },
  ],
  steps: [
    {
      name: 'review',
      prompt: 'Review the PR changes',
      model: 'claude-3-5-sonnet',
      max_tokens: 2048,
    },
  ],
  writeback: [
    { type: 'github', action: 'post_comment' },
  ],
  guardrails: {
    max_retries: 2,
    timeout_seconds: 120,
    require_human_approval: false,
  },
};

describe('sopDefinitionSchema', () => {
  it('validates a complete valid SOP', () => {
    const result = sopDefinitionSchema.safeParse(validSop);
    expect(result.success).toBe(true);
  });

  it('applies defaults for context, writeback, and guardrails', () => {
    const minimal = {
      name: 'minimal-sop',
      description: 'Minimal SOP',
      version: '1.0.0',
      trigger: { source: ['github'], type: ['push'] },
      steps: [
        { name: 'step1', prompt: 'Do something', model: 'gpt-4o', max_tokens: 100 },
      ],
    };
    const result = sopDefinitionSchema.parse(minimal);
    expect(result.context).toEqual([]);
    expect(result.writeback).toEqual([]);
    expect(result.guardrails.max_retries).toBe(0);
    expect(result.guardrails.timeout_seconds).toBe(300);
    expect(result.guardrails.require_human_approval).toBe(false);
  });

  it('rejects SOP with missing steps', () => {
    const { steps: _steps, ...noSteps } = validSop;
    expect(() => sopDefinitionSchema.parse(noSteps)).toThrow();
  });

  it('rejects SOP with empty steps array', () => {
    expect(() => sopDefinitionSchema.parse({ ...validSop, steps: [] })).toThrow();
  });

  it('rejects SOP with missing name', () => {
    const { name: _name, ...noName } = validSop;
    expect(() => sopDefinitionSchema.parse(noName)).toThrow();
  });

  it('rejects SOP with negative max_retries', () => {
    expect(() =>
      sopDefinitionSchema.parse({
        ...validSop,
        guardrails: { ...validSop.guardrails, max_retries: -1 },
      })
    ).toThrow();
  });

  it('rejects step with non-positive max_tokens', () => {
    expect(() =>
      sopDefinitionSchema.parse({
        ...validSop,
        steps: [{ ...validSop.steps[0], max_tokens: 0 }],
      })
    ).toThrow();
  });
});

describe('loadSops', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `vu-sops-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid YAML SOP file from directory', async () => {
    const yaml = `
name: test-sop
description: Test SOP for unit tests
version: 1.0.0
trigger:
  source:
    - github
  type:
    - push
steps:
  - name: analyze
    prompt: Analyze the push event
    model: claude-3-5-sonnet
    max_tokens: 512
`;
    await writeFile(join(tmpDir, 'test.yaml'), yaml, 'utf-8');
    const sops = await loadSops(tmpDir);
    expect(sops).toHaveLength(1);
    expect(sops[0].name).toBe('test-sop');
    expect(sops[0].steps).toHaveLength(1);
  });

  it('loads multiple YAML files from directory', async () => {
    const dir = join(tmpdir(), `vu-multi-sops-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const yaml1 = `
name: sop-one
description: First SOP
version: 1.0.0
trigger:
  source: [github]
  type: [push]
steps:
  - name: step1
    prompt: Prompt one
    model: gpt-4o
    max_tokens: 100
`;
    const yaml2 = `
name: sop-two
description: Second SOP
version: 2.0.0
trigger:
  source: [jira]
  type: [issue.created]
steps:
  - name: step2
    prompt: Prompt two
    model: gpt-4o
    max_tokens: 200
`;
    await writeFile(join(dir, 'sop1.yaml'), yaml1, 'utf-8');
    await writeFile(join(dir, 'sop2.yml'), yaml2, 'utf-8');
    const sops = await loadSops(dir);
    expect(sops).toHaveLength(2);
    const names = sops.map(s => s.name).sort();
    expect(names).toEqual(['sop-one', 'sop-two']);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty array for directory with no YAML files', async () => {
    const emptyDir = join(tmpdir(), `vu-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    await writeFile(join(emptyDir, 'notes.txt'), 'not yaml', 'utf-8');
    const sops = await loadSops(emptyDir);
    expect(sops).toEqual([]);
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('throws ZodError for invalid YAML content', async () => {
    const invalidDir = join(tmpdir(), `vu-invalid-${Date.now()}`);
    await mkdir(invalidDir, { recursive: true });
    const badYaml = `
name: bad-sop
# missing required fields: description, version, trigger, steps
`;
    await writeFile(join(invalidDir, 'bad.yaml'), badYaml, 'utf-8');
    await expect(loadSops(invalidDir)).rejects.toThrow();
    await rm(invalidDir, { recursive: true, force: true });
  });
});
