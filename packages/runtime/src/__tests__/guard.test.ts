import { describe, it, expect } from 'vitest';
import { validateOutput } from '../llm/guard.js';
import type { LLMResponse } from '../llm/client.js';

function makeResponse(content: string): LLMResponse {
  return {
    content,
    tokens_input: 10,
    tokens_output: 20,
    model: 'claude-3-5-sonnet-20241022',
    duration_ms: 100,
  };
}

describe('validateOutput', () => {
  it('returns valid=true for proper JSON response matching schema', () => {
    const response = makeResponse('{"name": "Alice", "age": 30}');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns valid=true for JSON wrapped in markdown code fence', () => {
    const content = '```json\n{"status": "ok", "count": 5}\n```';
    const response = makeResponse(content);
    const schema = { type: 'object' };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ status: 'ok', count: 5 });
  });

  it('returns valid=false with error for non-JSON response', () => {
    const response = makeResponse('This is plain text, not JSON');
    const schema = { type: 'object' };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Response is not valid JSON');
  });

  it('returns valid=false for JSON not matching schema (missing required field)', () => {
    const response = makeResponse('{"name": "Alice"}');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('returns valid=false for JSON with wrong field type', () => {
    const response = makeResponse('{"name": 123, "age": "old"}');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('returns valid=true for any object with a permissive schema', () => {
    const response = makeResponse('{"anything": true}');
    const schema = { type: 'object' };

    const result = validateOutput(response, schema);
    expect(result.valid).toBe(true);
  });
});
