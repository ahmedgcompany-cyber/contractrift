# ContractRift — instructions for AI coding assistants (AGENTS.md mirror of CLAUDE.md)

Read these before changing code:

0. [HANDOFF.md](HANDOFF.md) — **start here**: what was done, where everything is (repo, live demo, Google Cloud server), secrets locations, how to release and update the demo.
1. [AI_DEVELOPMENT_CONTEXT.md](AI_DEVELOPMENT_CONTEXT.md) — architecture, important files, **rules you must not break**.
2. [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md) — commands and step-by-step workflows.
3. [PROJECT_STATUS.md](PROJECT_STATUS.md) — what is done, partial, untested.

Verify changes with: `npm run typecheck && npm run lint && npm test` (and `npm run build && npm run test:e2e` for UI changes).
