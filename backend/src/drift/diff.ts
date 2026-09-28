import { sha256 } from '../lib/crypto.js';
import type { Baseline, DriftChange, JsonType, PathInfo, Severity, Shape, Signature } from './types.js';

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, breaking: 2 };

export function maxSeverity(changes: readonly DriftChange[]): Severity | null {
  let best: Severity | null = null;
  for (const c of changes) if (best === null || SEVERITY_RANK[c.severity] > SEVERITY_RANK[best]) best = c.severity;
  return best;
}

/** Parent path of `$.a.b` is `$.a`; of `$.a[]` is `$.a`; of `$["x y"]` is `$`. */
export function parentPath(path: string): string | null {
  if (path === '$') return null;
  if (path.endsWith('[]')) return path.slice(0, -2);
  if (path.endsWith('"]')) {
    // Find the opening `["` of the final quoted segment, honouring escapes inside JSON strings.
    for (let i = path.length - 3; i >= 1; i--) {
      if (path[i] === '"' && path[i - 1] === '[') {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && path[j] === '\\'; j--) backslashes++;
        if (backslashes % 2 === 0) return path.slice(0, i - 1);
      }
    }
  }
  const dot = path.lastIndexOf('.');
  return dot > 0 ? path.slice(0, dot) : '$';
}

const fmt = (types: readonly JsonType[]) => types.join(' | ');

/**
 * A missing path is "explained" (and so not reported separately) when an ancestor is reported
 * as changed, or an ancestor array is empty in the current observation.
 */
function explainedByAncestor(path: string, current: Shape, baseline: Shape): boolean {
  let p = parentPath(path);
  while (p !== null) {
    const cur = current.paths[p];
    if (cur) {
      const base = baseline.paths[p];
      const containerTypes: JsonType[] = ['object', 'array'];
      const curIsContainer = cur.types.some((t) => containerTypes.includes(t));
      if (!curIsContainer) return true; // ancestor turned into a scalar/null → reported there
      if (cur.types.includes('array') && cur.emptyArray) return true;
      if (base && cur.types.some((t) => !base.types.includes(t))) return true;
      return false;
    }
    p = parentPath(p);
  }
  return false;
}

export function diffShape(baseline: Shape, current: Shape): DriftChange[] {
  const changes: DriftChange[] = [];
  const required = (info: PathInfo) => info.count >= baseline.samples;

  for (const [path, base] of Object.entries(baseline.paths)) {
    const cur = current.paths[path];
    if (!cur) {
      if (required(base) && !explainedByAncestor(path, current, baseline)) {
        changes.push({
          kind: 'removed',
          path,
          severity: 'breaking',
          before: fmt(base.types),
          message: `Field ${path} (always present in the baseline) is missing.`,
        });
      }
      continue;
    }
    const newTypes = cur.types.filter((t) => !base.types.includes(t));
    if (newTypes.length === 0) continue;
    const onlyNull = newTypes.length === 1 && newTypes[0] === 'null';
    changes.push({
      kind: onlyNull ? 'nullable' : 'type_changed',
      path,
      severity: onlyNull ? 'warning' : 'breaking',
      before: fmt(base.types),
      after: fmt(cur.types),
      message: onlyNull
        ? `Field ${path} is now null (baseline: ${fmt(base.types)}).`
        : `Field ${path} changed type from ${fmt(base.types)} to ${fmt(cur.types)}.`,
    });
  }

  for (const [path, cur] of Object.entries(current.paths)) {
    if (baseline.paths[path]) continue;
    const parent = parentPath(path);
    // Report only the top-most new path, not every descendant of a new object.
    if (parent !== null && !baseline.paths[parent] && current.paths[parent]) continue;
    // Elements of arrays that were always empty in the baseline were simply never seen.
    if (parent !== null && baseline.paths[parent]?.emptyArray) continue;
    changes.push({
      kind: 'added',
      path,
      severity: 'info',
      after: fmt(cur.types),
      message: `New field ${path} (${fmt(cur.types)}).`,
    });
  }

  return changes;
}

export function diffSignature(baseline: Signature, current: Signature): DriftChange[] {
  const changes: DriftChange[] = [];
  for (const [key, base] of Object.entries(baseline)) {
    const cur = current[key];
    if (!cur) {
      changes.push({
        kind: 'signature_removed',
        path: key,
        severity: base.severity,
        before: base.value,
        message: `${base.label} is no longer present (was "${base.value}").`,
      });
    } else if (cur.value !== base.value) {
      changes.push({
        kind: 'signature_changed',
        path: key,
        severity: cur.severity,
        before: base.value,
        after: cur.value,
        message: `${cur.label} changed from "${base.value}" to "${cur.value}".`,
      });
    }
  }
  for (const [key, cur] of Object.entries(current)) {
    if (baseline[key]) continue;
    changes.push({
      kind: 'signature_added',
      path: key,
      severity: 'info',
      after: cur.value,
      message: `${cur.label} appeared ("${cur.value}").`,
    });
  }
  return changes;
}

export function diffBaseline(baseline: Baseline, shape: Shape | null, signature: Signature): DriftChange[] {
  const changes = shape ? diffShape(baseline.shape, shape) : [];
  changes.push(...diffSignature(baseline.signature, signature));
  return changes.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path));
}

/** Stable identity for a set of changes, used to deduplicate drift events. */
export function fingerprint(changes: readonly DriftChange[]): string {
  const canonical = changes
    .map((c) => [c.kind, c.path, c.before ?? '', c.after ?? ''].join('\u0000'))
    .sort()
    .join('\u0001');
  return sha256(canonical);
}

/**
 * Accepting an observation: every observed path becomes required, baseline-optional paths that
 * were not observed stay optional, required paths that disappeared are dropped.
 */
export function acceptObservation(baseline: Baseline, shape: Shape | null, signature: Signature): Baseline {
  const samples = Math.max(baseline.shape.samples, 1);
  if (!shape) return { shape: baseline.shape, signature: structuredClone(signature) };
  const paths: Record<string, PathInfo> = {};
  for (const [path, info] of Object.entries(shape.paths)) {
    paths[path] = { ...structuredClone(info), count: samples };
  }
  for (const [path, info] of Object.entries(baseline.shape.paths)) {
    if (paths[path] || info.count >= baseline.shape.samples) continue;
    paths[path] = { ...structuredClone(info), count: Math.min(info.count, samples - 1) };
  }
  return { shape: { samples, paths }, signature: structuredClone(signature) };
}
