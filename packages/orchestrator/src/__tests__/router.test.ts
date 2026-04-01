import { describe, it, expect } from 'vitest';
import { matchSop } from '../router.js';
import type { OrchestratorEvent, SopDefinition } from '@vu/core';

function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    id: 'evt-123',
    source: 'github',
    sourceEventId: 'gh-001',
    type: 'pull_request.opened',
    timestamp: new Date().toISOString(),
    payload: { action: 'opened', repo: 'my-repo' },
    meta: {
      tenant: 'tenant-1',
      deduplicationKey: 'gh-001',
      interactive: false,
    },
    ...overrides,
  };
}

function makeSop(overrides: Partial<SopDefinition> = {}): SopDefinition {
  return {
    name: 'test-sop',
    description: 'Test SOP',
    version: '1.0.0',
    trigger: {
      source: ['github'],
      type: ['pull_request.opened'],
    },
    context: [],
    steps: [
      {
        name: 'step1',
        prompt: 'Do something',
        model: 'gpt-4',
        max_tokens: 1000,
      },
    ],
    writeback: [],
    guardrails: {
      max_retries: 0,
      timeout_seconds: 300,
      require_human_approval: false,
    },
    ...overrides,
  };
}

describe('matchSop', () => {
  it('should return null when no SOPs are provided', () => {
    const event = makeEvent();
    expect(matchSop(event, [])).toBeNull();
  });

  it('should match a SOP by source and type', () => {
    const event = makeEvent();
    const sop = makeSop();
    expect(matchSop(event, [sop])).toBe(sop);
  });

  it('should return null when source does not match', () => {
    const event = makeEvent({ source: 'jira' });
    const sop = makeSop();
    expect(matchSop(event, [sop])).toBeNull();
  });

  it('should return null when type does not match', () => {
    const event = makeEvent({ type: 'pull_request.closed' });
    const sop = makeSop();
    expect(matchSop(event, [sop])).toBeNull();
  });

  it('should match when source has multiple values', () => {
    const event = makeEvent({ source: 'gitlab' });
    const sop = makeSop({
      trigger: { source: ['github', 'gitlab'], type: ['pull_request.opened'] },
    });
    expect(matchSop(event, [sop])).toBe(sop);
  });

  it('should match when type has multiple values', () => {
    const event = makeEvent({ type: 'pull_request.closed' });
    const sop = makeSop({
      trigger: { source: ['github'], type: ['pull_request.opened', 'pull_request.closed'] },
    });
    expect(matchSop(event, [sop])).toBe(sop);
  });

  it('should match filter with single value', () => {
    const event = makeEvent({ payload: { action: 'opened' } });
    const sop = makeSop({
      trigger: {
        source: ['github'],
        type: ['pull_request.opened'],
        filter: { action: 'opened' },
      },
    });
    expect(matchSop(event, [sop])).toBe(sop);
  });

  it('should not match when filter value does not match', () => {
    const event = makeEvent({ payload: { action: 'closed' } });
    const sop = makeSop({
      trigger: {
        source: ['github'],
        type: ['pull_request.opened'],
        filter: { action: 'opened' },
      },
    });
    expect(matchSop(event, [sop])).toBeNull();
  });

  it('should match filter with array of allowed values', () => {
    const event = makeEvent({ payload: { action: 'synchronize' } });
    const sop = makeSop({
      trigger: {
        source: ['github'],
        type: ['pull_request.opened'],
        filter: { action: ['opened', 'synchronize', 'reopened'] },
      },
    });
    expect(matchSop(event, [sop])).toBe(sop);
  });

  it('should not match when array filter does not include value', () => {
    const event = makeEvent({ payload: { action: 'closed' } });
    const sop = makeSop({
      trigger: {
        source: ['github'],
        type: ['pull_request.opened'],
        filter: { action: ['opened', 'synchronize'] },
      },
    });
    expect(matchSop(event, [sop])).toBeNull();
  });

  it('should return first matching SOP', () => {
    const event = makeEvent();
    const sop1 = makeSop({ name: 'sop-1' });
    const sop2 = makeSop({ name: 'sop-2' });
    expect(matchSop(event, [sop1, sop2])).toBe(sop1);
  });

  it('should skip non-matching SOPs and return next match', () => {
    const event = makeEvent({ source: 'jira' });
    const sop1 = makeSop({ name: 'sop-github', trigger: { source: ['github'], type: ['pull_request.opened'] } });
    const sop2 = makeSop({
      name: 'sop-jira',
      trigger: { source: ['jira'], type: ['pull_request.opened'] },
    });
    expect(matchSop(event, [sop1, sop2])).toBe(sop2);
  });

  it('should return null when filter key is missing from payload', () => {
    const event = makeEvent({ payload: {} });
    const sop = makeSop({
      trigger: {
        source: ['github'],
        type: ['pull_request.opened'],
        filter: { action: 'opened' },
      },
    });
    expect(matchSop(event, [sop])).toBeNull();
  });
});
