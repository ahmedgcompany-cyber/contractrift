import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { AssertionResultRow } from '../db/schema.js';
import { jsonType } from '../drift/shape.js';
import { evaluateJsonPath } from '../lib/jsonpath.js';
import type { JsonPathAssertion, TextAssertion } from './config.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const ajv = addFormats(new Ajv({ strict: false, allErrors: true }));
const compiled = new Map<string, ValidateFunction>();
const MAX_REGEX_INPUT = 64 * 1024;

export function compileSchema(schema: unknown): ValidateFunction {
  const key = JSON.stringify(schema);
  let fn = compiled.get(key);
  if (!fn) {
    fn = ajv.compile(schema as object);
    if (compiled.size > 500) compiled.clear();
    compiled.set(key, fn);
  }
  return fn;
}

/** Returns an error message if the schema is not a compilable JSON Schema. */
export function checkSchema(schema: unknown): string | null {
  try {
    compileSchema(schema);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Rejects patterns that are long or contain nested quantifiers such as `(a+)+`, the usual cause
 * of catastrophic backtracking. Heuristic — see SECURITY.md.
 */
export function checkRegex(pattern: string): string | null {
  if (pattern.length > 200) return 'Regular expressions are limited to 200 characters.';
  if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(pattern)) return 'Nested quantifiers (e.g. "(a+)+") are not allowed.';
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export function schemaAssertion(name: string, schema: unknown, value: unknown): AssertionResultRow {
  const validate = compileSchema(schema);
  if (validate(value)) return { name, ok: true, message: 'Matches the JSON Schema.' };
  const errors = (validate.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`)
    .join('; ');
  return { name, ok: false, message: `Does not match the JSON Schema: ${errors}` };
}

const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

export function evaluateJsonPathAssertion(doc: unknown, a: JsonPathAssertion): AssertionResultRow {
  const name = `${a.path} ${a.op}${a.value === undefined ? '' : ` ${show(a.value)}`}`;
  let res: { found: boolean; value: unknown };
  try {
    res = evaluateJsonPath(doc, a.path);
  } catch (err) {
    return { name, ok: false, message: `Invalid path: ${(err as Error).message}` };
  }
  const { found, value } = res;
  const fail = (message: string) => ({ name, ok: false, message });
  const pass = (message: string) => ({ name, ok: true, message });
  if (a.op === 'exists') return found ? pass('Present.') : fail('Not present.');
  if (a.op === 'notExists') return found ? fail(`Present (${show(value)}).`) : pass('Not present.');
  if (!found) return fail('Not present.');
  switch (a.op) {
    case 'equals':
      return JSON.stringify(value) === JSON.stringify(a.value) ? pass('Equal.') : fail(`Got ${show(value)}.`);
    case 'notEquals':
      return JSON.stringify(value) !== JSON.stringify(a.value) ? pass(`Got ${show(value)}.`) : fail('Values are equal.');
    case 'contains':
      if (typeof value === 'string') return value.includes(String(a.value)) ? pass('Contains.') : fail(`Got ${show(value)}.`);
      if (Array.isArray(value)) {
        return value.some((v) => JSON.stringify(v) === JSON.stringify(a.value)) ? pass('Contains.') : fail('Array does not contain value.');
      }
      return fail(`Cannot apply "contains" to ${jsonType(value)}.`);
    case 'matches': {
      if (typeof value !== 'string') return fail(`Cannot match ${jsonType(value)}.`);
      const err = checkRegex(String(a.value));
      if (err) return fail(err);
      return new RegExp(String(a.value)).test(value.slice(0, MAX_REGEX_INPUT)) ? pass('Matches.') : fail(`Got ${show(value)}.`);
    }
    case 'type':
      return jsonType(value) === a.value ? pass(`Is ${jsonType(value)}.`) : fail(`Is ${jsonType(value)}.`);
    case 'lt':
    case 'gt': {
      if (typeof value !== 'number' || typeof a.value !== 'number') return fail('Both sides must be numbers.');
      const ok = a.op === 'lt' ? value < a.value : value > a.value;
      return ok ? pass(`Got ${value}.`) : fail(`Got ${value}.`);
    }
    default:
      return fail('Unknown operator.');
  }
}

export function evaluateTextAssertion(text: string, a: TextAssertion): AssertionResultRow {
  const name = `output ${a.op}${a.value === undefined || a.op === 'jsonSchema' ? '' : ` ${show(a.value)}`}`;
  const pass = (message: string) => ({ name, ok: true, message });
  const fail = (message: string) => ({ name, ok: false, message });
  const excerpt = show(text.length > 120 ? `${text.slice(0, 117)}...` : text);
  switch (a.op) {
    case 'contains':
      return text.toLowerCase().includes(String(a.value).toLowerCase()) ? pass('Contains.') : fail(`Output was ${excerpt}.`);
    case 'notContains':
      return text.toLowerCase().includes(String(a.value).toLowerCase()) ? fail(`Output was ${excerpt}.`) : pass('Does not contain.');
    case 'equals':
      return text.trim() === String(a.value).trim() ? pass('Equal.') : fail(`Output was ${excerpt}.`);
    case 'matches': {
      const err = checkRegex(String(a.value));
      if (err) return fail(err);
      return new RegExp(String(a.value)).test(text.slice(0, MAX_REGEX_INPUT)) ? pass('Matches.') : fail(`Output was ${excerpt}.`);
    }
    case 'jsonValid':
    case 'jsonSchema': {
      const parsed = parseJsonLoose(text);
      if (parsed === undefined) return fail(`Output is not valid JSON: ${excerpt}.`);
      if (a.op === 'jsonValid') return pass('Valid JSON.');
      return { ...schemaAssertion(name, a.value, parsed), name };
    }
    default:
      return fail('Unknown operator.');
  }
}

/** Parses JSON, tolerating a surrounding Markdown code fence (common in LLM output). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    return undefined;
  }
}
