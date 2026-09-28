export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export type PathInfo = {
  /** Every JSON type observed at this path. */
  types: JsonType[];
  /** Number of samples in which this path was present. */
  count: number;
  /** For arrays: true if every observed instance was empty (children unknown). */
  emptyArray?: boolean;
};

/** Structural description of one or more JSON documents. */
export type Shape = {
  samples: number;
  paths: Record<string, PathInfo>;
  truncated?: boolean;
};

export type Severity = 'breaking' | 'warning' | 'info';

/** Exact values tracked separately from structure (e.g. reported LLM model). */
export type SignatureEntry = { value: string; severity: Severity; label: string };
export type Signature = Record<string, SignatureEntry>;

export type DriftChangeKind =
  'removed' | 'added' | 'type_changed' | 'nullable' | 'signature_changed' | 'signature_removed' | 'signature_added';

export type DriftChange = {
  kind: DriftChangeKind;
  path: string;
  severity: Severity;
  before?: string;
  after?: string;
  message: string;
};

export type Baseline = {
  shape: Shape;
  signature: Signature;
};
