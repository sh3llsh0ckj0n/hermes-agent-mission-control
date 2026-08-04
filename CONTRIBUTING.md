# Contributing

## Local baseline

Use Node.js 22 and the repository lockfile:

```sh
node --version
npm ci
```

Copy `.env.example` to `.env.local` and replace the `Required · Core`
placeholders with values for your local environment. Never commit `.env.local`,
database credentials, OAuth secrets, API keys, or production URLs.

Do not run Prisma migrations, `prisma db push`, seed commands, or bridge
processes unless the repository owner has explicitly reviewed and approved the
database change.

## Required checks

Run these before requesting review:

```sh
npm test
npm run typecheck
npm run lint:core
npm run build
```

`npm run lint:core` is the required deterministic lint target for the maintained
Hermes mission-control surface. The broader `npm run lint` command currently
includes a known legacy backlog and is not yet a required CI check.

## Branch and pull-request workflow

1. Update local `main` from `origin/main` using fast-forward only.
2. Create a focused branch named `codex/<short-kebab-case-purpose>`.
3. Keep changes limited to one reviewable concern and add focused tests.
4. Run all required checks and document any manual verification or limitations.
5. Obtain explicit approval before pushing the branch or merging its pull request.

Do not commit directly to `main`. Use a pull request for every change and complete
the repository pull-request checklist. Never include real secrets in commits,
logs, screenshots, workflow files, or pull-request descriptions.
