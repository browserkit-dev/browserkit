# Contributing to browserkit

## Prerequisites

- [Node.js](https://nodejs.org) >= 20
- [pnpm](https://pnpm.io) >= 10 (`npm install -g pnpm`)

---

## Working on core only

Clone the monorepo, install, build, and test:

```bash
git clone https://github.com/browserkit-dev/browserkit
cd browserkit
pnpm install
pnpm build
pnpm test
```

---

## Working on core + an adapter simultaneously

Adapter directories are gitignored in this repo — they live in their own GitHub repositories under [browserkit-dev](https://github.com/browserkit-dev). Clone the adapter you want into the `packages/` folder and pnpm will link `@browserkit-dev/core` to your local workspace automatically — no `npm link`, no `file:`, no manual steps.

```bash
# Clone the monorepo
git clone https://github.com/browserkit-dev/browserkit
cd browserkit

# Clone the adapter you want to work on into packages/
git clone https://github.com/browserkit-dev/adapter-hackernews packages/adapter-hackernews

# A single pnpm install links everything
pnpm install

# Build core then the adapter
pnpm build

# Run all unit tests (core + adapter)
pnpm test

# Run E2E smoke tests
pnpm test:e2e
```

Any change you make to `packages/core/src/` is visible in the adapter immediately after `pnpm --filter @browserkit-dev/core build`.

### Available adapters

| Adapter | Repo |
|---------|------|
| HackerNews | [browserkit-dev/adapter-hackernews](https://github.com/browserkit-dev/adapter-hackernews) |
| LinkedIn | [browserkit-dev/adapter-linkedin](https://github.com/browserkit-dev/adapter-linkedin) |
| Google Discover | [browserkit-dev/adapter-google-discover](https://github.com/browserkit-dev/adapter-google-discover) |
| Reddit | [browserkit-dev/adapter-reddit](https://github.com/browserkit-dev/adapter-reddit) |
| Booking.com | [browserkit-dev/adapter-booking](https://github.com/browserkit-dev/adapter-booking) |

---

## Releasing a new version of `@browserkit-dev/core`

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

**On every PR that changes core:**

```bash
pnpm changeset
# Follow the prompt: choose "patch" / "minor" / "major", write a summary
git add .changeset/
git commit -m "chore: add changeset"
```

When the PR is merged to `main`, the Release GitHub Action automatically:
1. Opens (or updates) a "Release PR" that bumps the version and updates `CHANGELOG.md`
2. When that Release PR is merged, publishes `@browserkit-dev/core` to npm

An `NPM_TOKEN` secret must be set in the repository settings for publishing to work.

---

## Adapter development

See any existing adapter as a reference — HackerNews is the simplest:
[browserkit-dev/adapter-hackernews](https://github.com/browserkit-dev/adapter-hackernews)

Scaffold a new adapter with:

```bash
npx @browserkit-dev/core create-adapter my-site
```

---

## Versioning and releases

Versioning rules are documented in full in [AGENTS.md — Versioning](https://github.com/browserkit-dev/browserkit/blob/main/AGENTS.md#versioning). The short version:

| Change | Bump |
|--------|------|
| Bug fix, doc/log change, no API change | `patch` |
| New feature, new optional API field | `minor` |
| Removed/renamed export, required new field | `major` |

Every PR that changes behavior needs a **changeset** before merging:

```bash
# Core monorepo
pnpm changeset

# Adapter repos
npx changeset
```

Follow the prompts: choose `patch` / `minor` / `major`, write a one-line user-facing summary, and commit the generated `.changeset/*.md` file in the same PR. The Release GitHub Action bumps the version and publishes to npm automatically when the changeset PR merges to `main`.
