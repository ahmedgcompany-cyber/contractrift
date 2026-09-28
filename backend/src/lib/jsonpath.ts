/**
 * Minimal JSONPath subset used by assertions:
 *   $            root
 *   .key         object member (identifier-like keys)
 *   ["key"]      object member (any key, JSON string syntax)
 *   [0]          array index (non-negative)
 * Wildcards, filters and recursive descent are intentionally not supported.
 */
export type Segment = string | number;

export function parseJsonPath(path: string): Segment[] {
  if (!path.startsWith('$')) throw new Error('Path must start with "$".');
  const segments: Segment[] = [];
  let i = 1;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      const m = /^[A-Za-z_$][\w$-]*/.exec(path.slice(i + 1));
      if (!m) throw new Error(`Invalid member name at position ${i + 1}.`);
      segments.push(m[0]);
      i += 1 + m[0].length;
    } else if (ch === '[') {
      const rest = path.slice(i);
      const idx = /^\[(\d+)\]/.exec(rest);
      if (idx?.[1]) {
        segments.push(Number(idx[1]));
        i += idx[0].length;
        continue;
      }
      const str = /^\[("(?:[^"\\]|\\.)*")\]/.exec(rest);
      if (!str?.[1]) throw new Error(`Invalid bracket expression at position ${i}.`);
      segments.push(JSON.parse(str[1]) as string);
      i += str[0].length;
    } else {
      throw new Error(`Unexpected character "${ch}" at position ${i}.`);
    }
  }
  return segments;
}

export function evaluateJsonPath(doc: unknown, path: string): { found: boolean; value: unknown } {
  let current: unknown = doc;
  for (const seg of parseJsonPath(path)) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current) || seg >= current.length) return { found: false, value: undefined };
      current = current[seg];
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, seg)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return { found: true, value: current };
}
