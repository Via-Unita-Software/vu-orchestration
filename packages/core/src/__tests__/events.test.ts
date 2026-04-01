import { describe, it, expect } from 'vitest';
import { createEvent, orchestratorEventSchema } from '../events.js';

const validEventParams = {
  source: 'github',
  sourceEventId: 'evt-001',
  type: 'pull_request.opened',
  payload: { pr: 42 },
  meta: {
    tenant: 'example-company',
    deduplicationKey: 'github-evt-001',
    interactive: false,
  },
};

describe('createEvent', () => {
  it('creates a valid event with a UUID id', () => {
    const event = createEvent(validEventParams);
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('creates a valid event with an ISO timestamp', () => {
    const event = createEvent(validEventParams);
    expect(() => new Date(event.timestamp)).not.toThrow();
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('preserves all provided params', () => {
    const event = createEvent(validEventParams);
    expect(event.source).toBe('github');
    expect(event.sourceEventId).toBe('evt-001');
    expect(event.type).toBe('pull_request.opened');
    expect(event.payload).toEqual({ pr: 42 });
    expect(event.meta.tenant).toBe('example-company');
    expect(event.meta.interactive).toBe(false);
  });

  it('includes optional triggeredBy when provided', () => {
    const event = createEvent({
      ...validEventParams,
      meta: { ...validEventParams.meta, triggeredBy: 'user@example.com' },
    });
    expect(event.meta.triggeredBy).toBe('user@example.com');
  });

  it('each call produces a unique id', () => {
    const event1 = createEvent(validEventParams);
    const event2 = createEvent(validEventParams);
    expect(event1.id).not.toBe(event2.id);
  });
});

describe('orchestratorEventSchema', () => {
  it('accepts a valid event', () => {
    const raw = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      source: 'github',
      sourceEventId: 'evt-001',
      type: 'push',
      timestamp: '2024-01-01T00:00:00.000Z',
      payload: {},
      meta: {
        tenant: 'acme',
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).not.toThrow();
  });

  it('rejects event with missing required fields', () => {
    const raw = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      source: 'github',
      // sourceEventId missing
      type: 'push',
      timestamp: '2024-01-01T00:00:00.000Z',
      payload: {},
      meta: {
        tenant: 'acme',
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).toThrow();
  });

  it('rejects event with invalid UUID', () => {
    const raw = {
      id: 'not-a-uuid',
      source: 'github',
      sourceEventId: 'evt-001',
      type: 'push',
      timestamp: '2024-01-01T00:00:00.000Z',
      payload: {},
      meta: {
        tenant: 'acme',
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).toThrow();
  });

  it('rejects event with invalid timestamp format', () => {
    const raw = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      source: 'github',
      sourceEventId: 'evt-001',
      type: 'push',
      timestamp: 'not-a-date',
      payload: {},
      meta: {
        tenant: 'acme',
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).toThrow();
  });

  it('rejects event with empty source string', () => {
    const raw = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      source: '',
      sourceEventId: 'evt-001',
      type: 'push',
      timestamp: '2024-01-01T00:00:00.000Z',
      payload: {},
      meta: {
        tenant: 'acme',
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).toThrow();
  });

  it('rejects event with missing meta.tenant', () => {
    const raw = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      source: 'github',
      sourceEventId: 'evt-001',
      type: 'push',
      timestamp: '2024-01-01T00:00:00.000Z',
      payload: {},
      meta: {
        // tenant missing
        deduplicationKey: 'key-1',
        interactive: true,
      },
    };
    expect(() => orchestratorEventSchema.parse(raw)).toThrow();
  });
});
