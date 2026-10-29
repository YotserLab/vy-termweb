# Contributing to VY-TermWEB

Thanks for your interest in contributing!

## Getting started

```bash
pnpm install        # installs the frontend workspace
pnpm dev            # Go backend (:32230) + Vite dev server with HMR (:32231)
```

Requirements: Go 1.24+ and Node.js 20+ with pnpm.

## Checks before submitting

```bash
pnpm lint           # TypeScript type check (frontend)
pnpm build          # Vite production build
cd backend && go vet . && go build .
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `refactor:`, `docs:`, `chore:` …).

## Ground rules

- **No mock data.** Every UI control must do something real — wire it to the
  backend or remove it. If you add a feature, implement it end-to-end.
- The backend is a standalone Go server (`backend/`). The frontend is
  React 19 + Vite (`frontend/`). Keep the socket.io events and REST
  contract in sync between them.
- Prefer functional components and `type` imports.
- Don't commit secrets, credentials or environment-specific paths.
- Run the checks above and describe how you verified the change.

## Reporting issues

Open an issue with steps to reproduce, your OS/browser and the server log
output. For security-sensitive reports, please say so explicitly in the
title and share details privately if possible.
