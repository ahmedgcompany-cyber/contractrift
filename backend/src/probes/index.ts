import { Value } from 'typebox/value';
import { validation } from '../lib/errors.js';
import { checkRegex, checkSchema } from './assertions.js';
import { CONFIG_DEFAULTS, CONFIG_SCHEMAS, type KindConfig, type MonitorKind, ProbeSecrets } from './config.js';
import { runHttpProbe } from './http.js';
import { runLlmProbe } from './llm.js';
import { runMcpProbe } from './mcp.js';
import type { ProbeContext, ProbeOutcome } from './types.js';

export type { ProbeContext, ProbeOutcome } from './types.js';

/** Applies defaults, validates structure and semantics; throws VALIDATION_ERROR with details. */
export function normalizeConfig<K extends MonitorKind>(kind: K, raw: unknown): KindConfig[K] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validation('config must be an object.');
  const merged = { ...CONFIG_DEFAULTS[kind], ...(raw as object) };
  const schema = CONFIG_SCHEMAS[kind];
  if (!Value.Check(schema, merged)) {
    const details = [...Value.Errors(schema, merged)].slice(0, 10).map((e) => ({
      path: `config${e.instancePath}`,
      message: e.message,
    }));
    throw validation(`Invalid ${kind} monitor configuration.`, details);
  }
  const cfg = merged as KindConfig[K];
  const problems: { path: string; message: string }[] = [];

  if (kind === 'http') {
    const c = cfg as KindConfig['http'];
    c.assertions.forEach((a, i) => {
      if (a.op === 'matches') {
        const err = checkRegex(String(a.value ?? ''));
        if (err) problems.push({ path: `config/assertions/${i}/value`, message: err });
      }
      if (!['exists', 'notExists'].includes(a.op) && a.value === undefined) {
        problems.push({ path: `config/assertions/${i}/value`, message: `Operator "${a.op}" needs a value.` });
      }
    });
    if (c.jsonSchema) {
      const err = checkSchema(c.jsonSchema);
      if (err) problems.push({ path: 'config/jsonSchema', message: err });
    }
  }
  if (kind === 'llm') {
    const c = cfg as KindConfig['llm'];
    c.textAssertions.forEach((a, i) => {
      if (a.op === 'matches') {
        const err = checkRegex(String(a.value ?? ''));
        if (err) problems.push({ path: `config/textAssertions/${i}/value`, message: err });
      }
      if (a.op === 'jsonSchema') {
        const err = checkSchema(a.value);
        if (err) problems.push({ path: `config/textAssertions/${i}/value`, message: err });
      }
      if (['contains', 'notContains', 'equals', 'matches'].includes(a.op) && typeof a.value !== 'string') {
        problems.push({ path: `config/textAssertions/${i}/value`, message: `Operator "${a.op}" needs a string value.` });
      }
    });
  }
  if (problems.length) throw validation(`Invalid ${kind} monitor configuration.`, problems);
  return cfg;
}

export function normalizeSecrets(raw: unknown): ProbeSecrets {
  const value = raw ?? {};
  if (!Value.Check(ProbeSecrets, value)) {
    const details = [...Value.Errors(ProbeSecrets, value)]
      .slice(0, 10)
      .map((e) => ({ path: `secrets${e.instancePath}`, message: e.message }));
    throw validation('Invalid secrets.', details);
  }
  return value as ProbeSecrets;
}

export function runProbe(kind: MonitorKind, config: unknown, secrets: ProbeSecrets, ctx: ProbeContext): Promise<ProbeOutcome> {
  switch (kind) {
    case 'http':
      return runHttpProbe(config as KindConfig['http'], secrets, ctx);
    case 'llm':
      return runLlmProbe(config as KindConfig['llm'], secrets, ctx);
    case 'mcp':
      return runMcpProbe(config as KindConfig['mcp'], secrets, ctx);
  }
}
