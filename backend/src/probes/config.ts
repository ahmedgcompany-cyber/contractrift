import { type Static, Type } from 'typebox';

const HeaderMap = Type.Record(Type.String({ pattern: "^[A-Za-z0-9!#$%&'*+.^_`|~-]+$", maxLength: 128 }), Type.String({ maxLength: 8192 }));
const LatencyMs = Type.Integer({ minimum: 1, maximum: 120_000 });
const PublicUrl = Type.String({ minLength: 8, maxLength: 2048, pattern: '^https?://' });

export const JsonPathAssertion = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 512, pattern: '^\\$' }),
    op: Type.Enum(['exists', 'notExists', 'equals', 'notEquals', 'contains', 'matches', 'type', 'lt', 'gt']),
    value: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
export type JsonPathAssertion = Static<typeof JsonPathAssertion>;

export const TextAssertion = Type.Object(
  {
    op: Type.Enum(['contains', 'notContains', 'matches', 'equals', 'jsonValid', 'jsonSchema']),
    value: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
export type TextAssertion = Static<typeof TextAssertion>;

export const HttpConfig = Type.Object(
  {
    url: PublicUrl,
    method: Type.Enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    headers: HeaderMap,
    body: Type.Optional(Type.String({ maxLength: 65_536 })),
    expectedStatus: Type.Array(Type.Integer({ minimum: 100, maximum: 599 }), { maxItems: 20 }),
    maxLatencyMs: Type.Optional(LatencyMs),
    followRedirects: Type.Boolean(),
    assertions: Type.Array(JsonPathAssertion, { maxItems: 50 }),
    jsonSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
export type HttpConfig = Static<typeof HttpConfig>;

export const LlmConfig = Type.Object(
  {
    provider: Type.Union([Type.Literal('openai'), Type.Literal('anthropic')]),
    /** Defaults: https://api.openai.com/v1 and https://api.anthropic.com */
    baseUrl: Type.Optional(PublicUrl),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    system: Type.Optional(Type.String({ maxLength: 8000 })),
    maxTokens: Type.Integer({ minimum: 1, maximum: 4096 }),
    temperature: Type.Number({ minimum: 0, maximum: 2 }),
    anthropicVersion: Type.Optional(Type.String({ maxLength: 32 })),
    headers: HeaderMap,
    maxLatencyMs: Type.Optional(LatencyMs),
    textAssertions: Type.Array(TextAssertion, { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type LlmConfig = Static<typeof LlmConfig>;

export const McpConfig = Type.Object(
  {
    url: PublicUrl,
    protocol: Type.Union([Type.Literal('auto'), Type.Literal('modern'), Type.Literal('legacy')]),
    headers: HeaderMap,
    expectedTools: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 }),
    toolCall: Type.Optional(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 200 }),
          arguments: Type.Record(Type.String(), Type.Unknown()),
          expectText: Type.Optional(Type.String({ maxLength: 1000 })),
        },
        { additionalProperties: false },
      ),
    ),
    maxLatencyMs: Type.Optional(LatencyMs),
  },
  { additionalProperties: false },
);
export type McpConfig = Static<typeof McpConfig>;

export const ProbeSecrets = Type.Object(
  {
    headers: Type.Optional(HeaderMap),
    apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type ProbeSecrets = Static<typeof ProbeSecrets>;

export type MonitorKind = 'http' | 'llm' | 'mcp';
export type KindConfig = { http: HttpConfig; llm: LlmConfig; mcp: McpConfig };

export const CONFIG_SCHEMAS = { http: HttpConfig, llm: LlmConfig, mcp: McpConfig } as const;

/** Defaults applied before validation so clients can send minimal configs. */
export const CONFIG_DEFAULTS: { [K in MonitorKind]: Partial<KindConfig[K]> } = {
  http: { method: 'GET', headers: {}, expectedStatus: [], followRedirects: false, assertions: [] },
  llm: { maxTokens: 32, temperature: 0, headers: {}, textAssertions: [] },
  mcp: { protocol: 'auto', headers: {}, expectedTools: [] },
};
