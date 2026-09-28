# Contributing to ContractRift

Thanks for helping! Bug reports, docs fixes and pull requests are welcome.

## Before you start

- Read [AI_DEVELOPMENT_CONTEXT.md](AI_DEVELOPMENT_CONTEXT.md) ("rules you must not break") and
  [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).
- For larger changes, open an issue first so we can agree on the approach.
- Security issues: **do not** open a public issue — see [SECURITY.md](SECURITY.md).

## Workflow

```bash
npm ci && cp .env.example .env && npm run gen-key   # put the key into .env
npm run typecheck && npm run lint && npm test       # must pass
npm run build && npm run test:e2e                   # for UI changes
```

Keep changes small, add tests, update the relevant docs and `CHANGELOG.md` (Unreleased).

## Contribution license

ContractRift is dual-licensed (AGPL-3.0 and commercial, see [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md)).
By submitting a contribution you agree that:

1. you wrote it or otherwise have the right to submit it;
2. it is licensed to the project under the AGPL-3.0; and
3. you grant the project maintainer a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   license to use, modify, sublicense and distribute your contribution under other license terms,
   including commercial licenses.

Add `Signed-off-by: Your Name <email>` to each commit (`git commit -s`) to confirm this.
