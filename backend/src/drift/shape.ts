import type { JsonType, PathInfo, Shape } from './types.js';

export const MAX_DEPTH = 32;
export const MAX_PATHS = 5000;

export function jsonType(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/** Keys are quoted when they are not simple identifiers, so paths stay unambiguous. */
export function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$-]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function isIgnored(path: string, ignorePaths: readonly string[]): boolean {
  return ignorePaths.some((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
}

/**
 * Infers the structural shape of one JSON document. Array elements are merged under `[]`,
 * so `[{a:1},{b:2}]` yields `$[].a` and `$[].b`, each present in this one sample.
 */
export function inferShape(doc: unknown, ignorePaths: readonly string[] = []): Shape {
  const paths: Record<string, PathInfo> = {};
  let truncated = false;

  const record = (path: string, type: JsonType, emptyArray?: boolean) => {
    const existing = paths[path];
    if (!existing) {
      if (Object.keys(paths).length >= MAX_PATHS) {
        truncated = true;
        return false;
      }
      paths[path] = { types: [type], count: 1, ...(type === 'array' ? { emptyArray: !!emptyArray } : {}) };
      return true;
    }
    if (!existing.types.includes(type)) existing.types.push(type);
    if (type === 'array') existing.emptyArray = (existing.emptyArray ?? true) && !!emptyArray;
    return true;
  };

  const walk = (value: unknown, path: string, depth: number) => {
    if (isIgnored(path, ignorePaths)) return;
    const type = jsonType(value);
    if (!record(path, type, type === 'array' ? (value as unknown[]).length === 0 : undefined)) return;
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (type === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, childPath(path, k), depth + 1);
    } else if (type === 'array') {
      for (const item of value as unknown[]) walk(item, `${path}[]`, depth + 1);
    }
  };

  walk(doc, '$', 0);
  for (const info of Object.values(paths)) info.types.sort();
  return truncated ? { samples: 1, paths, truncated } : { samples: 1, paths };
}

/** Merges shapes from independent samples: union of types, summed presence counts. */
export function mergeShapes(a: Shape, b: Shape): Shape {
  const paths: Record<string, PathInfo> = structuredClone(a.paths);
  for (const [path, info] of Object.entries(b.paths)) {
    const existing = paths[path];
    if (!existing) {
      paths[path] = structuredClone(info);
      continue;
    }
    existing.count += info.count;
    for (const t of info.types) if (!existing.types.includes(t)) existing.types.push(t);
    existing.types.sort();
    if (existing.emptyArray !== undefined || info.emptyArray !== undefined) {
      existing.emptyArray = (existing.emptyArray ?? true) && (info.emptyArray ?? true);
    }
  }
  const merged: Shape = { samples: a.samples + b.samples, paths };
  if (a.truncated || b.truncated) merged.truncated = true;
  return merged;
}

export function emptyShape(): Shape {
  return { samples: 0, paths: {} };
}
