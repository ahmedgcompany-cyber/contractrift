# Schema

The schema is defined in TypeScript in [`backend/src/db/schema.ts`](../../backend/src/db/schema.ts)
(Drizzle ORM) — the single source of truth. The SQL it produces lives in
[`../migrations`](../migrations). Table-by-table documentation: [DATABASE.md](../../DATABASE.md).

It is deliberately not duplicated here as SQL to avoid two definitions drifting apart.
