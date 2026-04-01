import Ajv from 'ajv';
import type { LLMResponse } from './client.js';

const ajv = new Ajv({ allErrors: true });

export interface GuardResult {
  valid: boolean;
  parsed?: Record<string, unknown>;
  errors?: string[];
}

export function validateOutput(
  response: LLMResponse,
  schema: Record<string, unknown>
): GuardResult {
  // Try to extract JSON from the response
  let parsed: Record<string, unknown>;
  try {
    const jsonMatch =
      response.content.match(/```json\n?([\s\S]*?)\n?```/) ||
      response.content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : response.content;
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return { valid: false, errors: ['Response is not valid JSON'] };
  }

  const validate = ajv.compile(schema);
  const valid = validate(parsed) as boolean;

  if (!valid) {
    const errors = validate.errors?.map((e) => `${e.instancePath} ${e.message}`) || [];
    return { valid: false, errors };
  }

  return { valid: true, parsed };
}
