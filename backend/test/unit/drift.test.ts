import { describe, expect, it } from 'vitest';
import { acceptObservation, diffBaseline, diffShape, fingerprint, maxSeverity, parentPath } from '../../src/drift/diff.js';
import { inferShape, mergeShapes } from '../../src/drift/shape.js';
import type { Baseline, Shape } from '../../src/drift/types.js';

const learn = (...docs: unknown[]): Shape => docs.map((d) => inferShape(d)).reduce((a, b) => mergeShapes(a, b));

describe('inferShape', () => {
  it('records paths, types and array element paths', () => {
    const s = inferShape({ id: 1, name: 'x', tags: ['a'], items: [{ sku: 'a', qty: 1 }, { sku: 'b' }], meta: null });
    expect(Object.keys(s.paths).sort()).toEqual(
      ['$', '$.id', '$.items', '$.items[]', '$.items[].qty', '$.items[].sku', '$.meta', '$.name', '$.tags', '$.tags[]'].sort(),
    );
    expect(s.paths['$.meta']?.types).toEqual(['null']);
    expect(s.paths['$.items']?.emptyArray).toBe(false);
  });

  it('quotes non-identifier keys', () => {
    const s = inferShape({ 'content-type': 'x', 'a b': { c: 1 } });
    expect(s.paths['$.content-type']).toBeDefined();
    expect(s.paths['$["a b"].c']).toBeDefined();
  });

  it('honours ignorePaths', () => {
    const s = inferShape({ keep: 1, volatile: { x: 1 } }, ['$.volatile']);
    expect(s.paths['$.volatile']).toBeUndefined();
    expect(s.paths['$.volatile.x']).toBeUndefined();
    expect(s.paths['$.keep']).toBeDefined();
  });

  it('marks empty arrays', () => {
    expect(inferShape({ list: [] }).paths['$.list']?.emptyArray).toBe(true);
  });

  it('truncates very large documents and says so', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) big[`k${i}`] = i;
    const s = inferShape(big);
    expect(s.truncated).toBe(true);
    expect(Object.keys(s.paths).length).toBe(5000);
  });
});

describe('parentPath', () => {
  it.each([
    ['$.a.b', '$.a'],
    ['$.a[]', '$.a'],
    ['$.a', '$'],
    ['$["x y"]', '$'],
    ['$.a["x.y"].z', '$.a["x.y"]'],
    ['$.a["x.y"]', '$.a'],
    ['$', null],
  ])('%s → %s', (p, parent) => expect(parentPath(p)).toBe(parent));
});

describe('diffShape', () => {
  const baseline = learn(
    { id: 1, name: 'a', email: 'x@y', nickname: 'n', items: [{ sku: 's' }] },
    { id: 2, name: 'b', email: 'x@y', items: [{ sku: 't' }] },
    { id: 3, name: 'c', email: 'x@y', items: [{ sku: 'u' }] },
  );

  it('reports nothing for an equivalent document', () => {
    expect(diffShape(baseline, inferShape({ id: 9, name: 'z', email: 'q', items: [{ sku: 'v' }] }))).toEqual([]);
  });

  it('flags removal of an always-present field as breaking', () => {
    const changes = diffShape(baseline, inferShape({ id: 9, name: 'z', items: [{ sku: 'v' }] }));
    expect(changes).toEqual([expect.objectContaining({ kind: 'removed', path: '$.email', severity: 'breaking' })]);
  });

  it('does not flag removal of an optional field', () => {
    expect(diffShape(baseline, inferShape({ id: 9, name: 'z', email: 'e', items: [{ sku: 'v' }] }))).toEqual([]);
  });

  it('flags type changes as breaking', () => {
    const changes = diffShape(baseline, inferShape({ id: '9', name: 'z', email: 'e', items: [{ sku: 'v' }] }));
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'type_changed', path: '$.id', before: 'number', after: 'string', severity: 'breaking' }),
    ]);
  });

  it('flags newly-null fields as a warning', () => {
    const changes = diffShape(baseline, inferShape({ id: 1, name: null, email: 'e', items: [{ sku: 'v' }] }));
    expect(changes).toEqual([expect.objectContaining({ kind: 'nullable', path: '$.name', severity: 'warning' })]);
  });

  it('reports only the top-most added path', () => {
    const changes = diffShape(baseline, inferShape({ id: 1, name: 'a', email: 'e', items: [{ sku: 'v' }], extra: { a: { b: 1 } } }));
    expect(changes).toEqual([expect.objectContaining({ kind: 'added', path: '$.extra', severity: 'info' })]);
  });

  it('does not report children of an array that became empty', () => {
    expect(diffShape(baseline, inferShape({ id: 1, name: 'a', email: 'e', items: [] }))).toEqual([]);
  });

  it('reports a container that became a scalar once, not its children', () => {
    const changes = diffShape(baseline, inferShape({ id: 1, name: 'a', email: 'e', items: 'gone' }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'type_changed', path: '$.items' });
  });

  it('does not report elements of arrays that were always empty in the baseline', () => {
    const b = learn({ list: [] }, { list: [] });
    expect(diffShape(b, inferShape({ list: [{ a: 1 }] }))).toEqual([]);
  });
});

describe('diffBaseline and signatures', () => {
  const baseline: Baseline = {
    shape: learn({ a: 1 }),
    signature: { model: { value: 'gpt-x-2025', severity: 'warning', label: 'Reported model' } },
  };

  it('detects signature value changes with the entry severity', () => {
    const changes = diffBaseline(baseline, inferShape({ a: 1 }), {
      model: { value: 'gpt-x-2026', severity: 'warning', label: 'Reported model' },
    });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'signature_changed', before: 'gpt-x-2025', after: 'gpt-x-2026', severity: 'warning' }),
    ]);
  });

  it('sorts breaking changes first and computes max severity', () => {
    const changes = diffBaseline(baseline, inferShape({ a: 'x', b: 1 }), {});
    expect(changes.map((c) => c.severity)).toEqual(['breaking', 'warning', 'info']);
    expect(maxSeverity(changes)).toBe('breaking');
    expect(maxSeverity([])).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is order independent and content sensitive', () => {
    const a = diffShape(learn({ x: 1, y: 1 }), inferShape({}));
    const b = [...a].reverse();
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(a.slice(1)));
  });
});

describe('acceptObservation', () => {
  it('makes the accepted observation the new truth and keeps optional fields optional', () => {
    const baseline: Baseline = { shape: learn({ a: 1, opt: 1 }, { a: 1 }, { a: 1 }), signature: {} };
    const observed = inferShape({ a: 'now-string', b: true });
    const accepted = acceptObservation(baseline, observed, {});
    expect(diffShape(accepted.shape, inferShape({ a: 'x', b: false }))).toEqual([]);
    expect(diffShape(accepted.shape, inferShape({ a: 'x', b: false, opt: 2 }))).toEqual([]);
    expect(diffShape(accepted.shape, inferShape({ a: 'x' }))).toEqual([expect.objectContaining({ kind: 'removed', path: '$.b' })]);
  });
});
