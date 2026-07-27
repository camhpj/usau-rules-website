# Dev container sandbox — design

**Date:** 2026-07-25
**Status:** Approved approach
**Ported from:** `dc-data-company/common-school-agents` `.devcontainer/` (Python /
uv / Pulumi stack). Same architecture — Docker sandbox, egress firewall, Claude
Code managed settings — retargeted at this repo's Node / SvelteKit / Cloudflare
Workers stack.

## Goal

A sandboxed container for running Claude Code against this repo: network egress
locked to an allowlist, auth forwarded from the host, and the full local
workflow (`dev`, `check`, `test`, `build`, `test:e2e`, local D1) working inside
it. No production credentials or capabilities beyond what the developer already
has on the host.

## Decisions (from brainstorming)

- **Playwright:** baked in. Chromium's apt dependencies are installed at image
  build; the browser binary is downloaded in `postCreateCommand` so it tracks
  `@playwright/test` in `package.json` rather than drifting from a Dockerfile
  ARG. Cached in a named volume.
- **`node_modules`:** per-container named volume at `/workspace/node_modules`.
  The host is macOS and the tree contains platform-specific binaries (`workerd`,
  `esbuild`, `rollup`); sharing the bind mount would break one side or the
  other. Mirrors the reference's `.venv` volume.
- **Worktrees:** worktree-only config, carried over from the reference. The
  workspace is assumed to live at `<repo>/.claude/worktrees/<name>`, and the
  main repo's `.git` is bind-mounted at its absolute host path so the worktree's
  `.git` pointer resolves. Opening the main repo directly will fail on that
  mount.
- **No `model` pin** in managed settings (the reference pins one); normal model
  selection applies.

## Files

`.devcontainer/`, six files, same shape as the reference:

| File | Role |
| --- | --- |
| `Dockerfile` | image: Node base, CLI tooling, `dev` user, Claude Code, firewall script, managed settings |
| `devcontainer.json` | mounts, volumes, env forwarding, extensions, lifecycle commands |
| `init-firewall.sh` | egress allowlist, applied at container start |
| `managed-settings.json` | Claude Code auto-mode trust list, baked to `/etc/claude-code/` |
| `zshrc` | oh-my-zsh config for the `dev` user |
| `README.md` | how to boot it, what the firewall covers, how to change it |

`.gitignore` has a blanket `.claude/` entry, so worktrees stay untracked — but
`.devcontainer/` is tracked at the repo root and is therefore present in every
worktree checkout, which is what makes the worktree-only config work.

## Image

Base becomes `node:24-bookworm-slim` (host runs 24.16; `engines` requires ≥22)
instead of `python:3.14-slim` plus nodesource.

**Dropped from the reference:** `uv`, Task, sops, age, Pulumi, shellcheck.

**Kept, essentially verbatim:** firewall tooling (`iptables`, `ipset`,
`aggregate`, `dnsutils`), `gh`, git-delta, the non-root `dev` user, Claude Code
installed into a user-owned npm prefix (so `claude update` can rename the
package dir in place), the NOPASSWD sudoers entry scoped to the firewall script,
`/commandhistory`, oh-my-zsh with the same theme and plugins, and
`managed-settings.json` baked root-owned at `/etc/claude-code/`.

**Added:** Chromium's system libraries via `npx --yes playwright@<pinned>
install-deps chromium` at build time. The pin only affects which apt packages
get installed, not which browser build runs.

## Container config

**Volumes** (all named, so nothing leaks into the host bind mount):

- `/commandhistory` and `/home/dev/.claude` — per `devcontainerId`, as in the reference
- `/workspace/node_modules` — per `devcontainerId`
- `/home/dev/.cache/ms-playwright` — shared, survives rebuilds
- npm cache — shared

**Ports forwarded:** 5173 (`vite dev`) and 8787 (`wrangler dev`, the e2e base URL).

**Extensions:** the three from `.vscode/extensions.json` (`svelte.svelte-vscode`,
`bradlc.vscode-tailwindcss`, `esbenp.prettier-vscode`) plus
`anthropic.claude-code`.

**Auth forwarding:** `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` from the host, as
in the reference.

**`postCreateCommand`:** `gh auth setup-git`, the two `url.…insteadOf` git
rewrites, `npm ci`, `npx playwright install chromium`, and `cp .dev.vars.example
.dev.vars` if the file is absent — worktrees don't carry the gitignored original.

**`postStartCommand`:** `sudo /usr/local/bin/init-firewall.sh`, with
`waitFor: postStartCommand`.

## Firewall

`init-firewall.sh` keeps the reference's structure unchanged — preserve Docker's
DNS nat rules, scope DNS to the detected resolver, build an `allowed-domains`
ipset from GitHub's published ranges plus per-domain `dig` lookups, allow the
connected host subnet, then default-deny with an ESTABLISHED/RELATED accept and
a final REJECT. The closing verification (blocked host fails, `api.github.com`
succeeds) is kept.

Retained allowlist entries: `api.anthropic.com`, `registry.npmjs.org`,
`downloads.claude.ai`, and the VS Code Server hosts.

Removed: everything Python-, Pulumi-, and Hetzner-specific, plus the
`host.docker.internal` block — there is no host-side compose stack in this
project. That also removes the Docker Desktop IPv6 section from the README.

Added:

| Host | Why |
| --- | --- |
| `api.cloudflare.com`, `dash.cloudflare.com` | wrangler auth, D1, deploy |
| `usaurules.com` | the deployed site itself |
| `generativelanguage.googleapis.com` | the worker's Gemini calls, so Ask/Scenario work under `wrangler dev` |
| `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` | server-side OAuth token exchange for local sign-in |
| `usaultimate.org` | `npm run ingest -- --refetch` |
| `cdn.playwright.dev`, `playwright.download.prss.microsoft.com` | Playwright browser downloads |
| `svelte.dev`, `developers.cloudflare.com`, `orm.drizzle.team`, `www.better-auth.com`, `bits-ui.com`, `tailwindcss.com`, `vite.dev`, `vitest.dev`, `playwright.dev`, `www.typescriptlang.org` | stack documentation |

As in the reference, the ipset reflects the DNS resolution from the last script
run: editing `ALLOWED_DOMAINS` requires re-running the script (or rebuilding),
and CDN-fronted hosts can rotate IPs mid-session. The firewall is runtime-only
and does not constrain `docker build`.

## Managed settings

`autoMode.environment` is rewritten for this project. `$defaults` first, then:

- **Source control** (replacing the default entry): `github.com/camhpj/usau-rules-website`. Pushes, PRs, and reads there are routine.
- **Package registry:** npm. Installing declared dependencies (`npm ci`, bare `npm install`) is routine; anything that adds a new dependency to `package.json` requires explicit confirmation each time — supply-chain implications.
- **Local development:** `wrangler dev`, local D1 (`db:migrate:local`, `wrangler d1 execute --local`), Vitest, and Playwright against `127.0.0.1:8787` are routine. The local D1 store under `.wrangler/state` is disposable.
- **Production, gated:** `wrangler deploy` and any `--remote` D1 command (including `db:migrate:remote`) require explicit user confirmation each time — they touch the live `usaurules.com` worker and its production database.
- **Environment:** this session runs inside a sandboxed dev container.

Block-and-allow rules stay inherited from `$defaults`; only `environment` is
customized, so web research is not further restricted.

## Verification

Manual, after the container comes up:

1. `curl --connect-timeout 5 https://example.com` fails; `curl --connect-timeout 5 https://api.github.com/zen` succeeds.
2. `npm run check`, `npm run test`, `npm run build` pass.
3. `npm run db:migrate:local` then `npm run test:e2e` passes.
4. `gh auth status` and `claude` are both authenticated from the forwarded host tokens.
