import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { sopDefinitionSchema, loadSops } from '../sops.js';

// Resolve the sops/ directory at the monorepo root
// __tests__/ → src/ → core/ → packages/ → (root)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SOPS_DIR = resolve(__dirname, '../../../..', 'sops');

const EXPECTED_SOPS = [
  'ticket-screener',
  'pr-review',
  'support-draft',
  'code-qa',
  'release-notes',
  'weekly-digest',
];

describe('Starter SOPs integration', () => {
  it('loads all 6 starter SOPs from the sops/ directory', async () => {
    const sops = await loadSops(SOPS_DIR);
    // Filter out _template.yaml (name is 'your-sop-name') from count check
    const starterSops = sops.filter(s => EXPECTED_SOPS.includes(s.name));
    expect(starterSops).toHaveLength(EXPECTED_SOPS.length);
  });

  it('every starter SOP validates against sopDefinitionSchema', async () => {
    const sops = await loadSops(SOPS_DIR);
    const starterSops = sops.filter(s => EXPECTED_SOPS.includes(s.name));
    for (const sop of starterSops) {
      const result = sopDefinitionSchema.safeParse(sop);
      expect(result.success, `SOP "${sop.name}" failed schema validation`).toBe(true);
    }
  });

  it('every starter SOP has required top-level fields', async () => {
    const sops = await loadSops(SOPS_DIR);
    const starterSops = sops.filter(s => EXPECTED_SOPS.includes(s.name));
    for (const sop of starterSops) {
      expect(sop.name, `${sop.name}: missing name`).toBeTruthy();
      expect(sop.description, `${sop.name}: missing description`).toBeTruthy();
      expect(sop.version, `${sop.name}: missing version`).toBeTruthy();
      expect(sop.trigger, `${sop.name}: missing trigger`).toBeDefined();
      expect(sop.trigger.source.length, `${sop.name}: trigger.source is empty`).toBeGreaterThan(0);
      expect(sop.trigger.type.length, `${sop.name}: trigger.type is empty`).toBeGreaterThan(0);
      expect(sop.steps.length, `${sop.name}: steps is empty`).toBeGreaterThan(0);
    }
  });

  it('every step has a prompt path, model, and positive max_tokens', async () => {
    const sops = await loadSops(SOPS_DIR);
    const starterSops = sops.filter(s => EXPECTED_SOPS.includes(s.name));
    for (const sop of starterSops) {
      for (const step of sop.steps) {
        expect(step.prompt, `${sop.name}/${step.name}: missing prompt`).toBeTruthy();
        expect(step.model, `${sop.name}/${step.name}: missing model`).toBeTruthy();
        expect(step.max_tokens, `${sop.name}/${step.name}: max_tokens must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it('ticket-screener has freshdesk context and classify step', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'ticket-screener');
    expect(sop).toBeDefined();
    expect(sop!.context.some(c => c.type === 'freshdesk')).toBe(true);
    expect(sop!.steps[0].name).toBe('classify');
    expect(sop!.steps[0].output_schema).toBe('TicketClassification');
  });

  it('pr-review triggers on pr.opened and mr.opened', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'pr-review');
    expect(sop).toBeDefined();
    expect(sop!.trigger.type).toContain('pr.opened');
    expect(sop!.trigger.type).toContain('mr.opened');
  });

  it('support-draft has require_human_approval false', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'support-draft');
    expect(sop).toBeDefined();
    expect(sop!.guardrails.require_human_approval).toBe(false);
  });

  it('code-qa has empty writeback', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'code-qa');
    expect(sop).toBeDefined();
    expect(sop!.writeback).toEqual([]);
  });

  it('release-notes has ReleaseNotes output_schema', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'release-notes');
    expect(sop).toBeDefined();
    expect(sop!.steps[0].output_schema).toBe('ReleaseNotes');
  });

  it('weekly-digest requires human approval', async () => {
    const sops = await loadSops(SOPS_DIR);
    const sop = sops.find(s => s.name === 'weekly-digest');
    expect(sop).toBeDefined();
    expect(sop!.guardrails.require_human_approval).toBe(true);
  });
});
