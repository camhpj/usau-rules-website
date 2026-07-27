# Dev Container

Sandboxed environment for running Claude Code against this repo. Boot it via VS Code's **Dev Containers: Reopen in Container** or `devcontainer up --workspace-folder .`. Auth is forwarded from the host: `GH_TOKEN` authenticates `gh` (and git, via `gh auth setup-git` in `postCreateCommand`), and `CLAUDE_CODE_OAUTH_TOKEN` authenticates `claude`. Claude's first-launch preferences persist across rebuilds via a named volume on `~/.claude`.

`postCreateCommand` also runs `npm ci`, downloads Playwright's Chromium, and copies `.dev.vars.example` to `.dev.vars` if that file is missing — worktrees don't inherit the gitignored original. Fill in real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GEMINI_API_KEY` values if you need sign-in or the AI features.

## Worktrees

**This config assumes the workspace is a worktree at `<repo>/.claude/worktrees/<name>`.** The last entry in `mounts` bind-mounts the main repo's `.git` at its absolute host path so the worktree's `.git` pointer resolves inside the container. Opening the repo root directly will fail on that mount — delete the line first. One config can't cover both cases until dev containers support optional mounts ([vscode-remote-release#5322](https://github.com/microsoft/vscode-remote-release/issues/5322)).

## Pushing to GitHub

`GH_TOKEN` is forwarded from the host, and inside the container it is the _only_ credential git has — there's no keychain to fall back on. If your host `GH_TOKEN` is a read-only PAT, pushes from inside the container will 403. Launch with the credential `gh` stores instead:

```bash
GH_TOKEN=$(env -u GH_TOKEN gh auth token) devcontainer up --workspace-folder .
```

(The `env -u` matters: `gh auth token` prefers `GH_TOKEN` from the environment, so without it you'd read the same read-only PAT straight back out.)

## node_modules

`/workspace/node_modules` is a named volume, not part of the bind mount, so the container's Linux install and the host's macOS install stay separate — `workerd`, `esbuild` and `rollup` all ship platform-specific binaries that aren't interchangeable. Consequence: adding a dependency inside the container updates `package.json` and `package-lock.json` on the host (those are bind-mounted), but the host's `node_modules` won't have it until you `npm install` there too. The volume is scoped per container, so each worktree gets its own.

## Playwright

Chromium's system libraries are baked into the image; the browser build is downloaded by `postCreateCommand` so it matches `@playwright/test` in `package.json` rather than drifting from a version pinned in the Dockerfile. It's cached in a shared named volume, so a rebuild doesn't re-download it — but after bumping `@playwright/test` you'll need `npx playwright install chromium` again.

The e2e suite starts its own `wrangler dev` on 8787 (see `playwright.config.ts`); both 8787 and Vite's 5173 are forwarded to the host.

## Shell

`zsh` with `oh-my-zsh` (`robbyrussell` theme, `git` + `zsh-autosuggestions` + `zsh-syntax-highlighting` plugins) is preinstalled. The config lives at [`zshrc`](zshrc) — edit and rebuild to change defaults. To override with your own setup instead, set `dev.containers.dotfilesRepository` and `dev.containers.dotfilesInstallCommand` in your VS Code user settings; the dotfiles clone goes through GitHub, which the firewall permits.

## Auto mode

Claude Code's auto-mode classifier trusts a small set of destinations beyond the working repo: the `camhpj/usau-rules-website` repository, the npm registry, `api.anthropic.com`, and the local `wrangler dev` server and D1 database. Production is explicitly _not_ trusted — `wrangler deploy`, `npm run db:migrate:remote`, and any `wrangler d1 ... --remote` are marked as requiring confirmation each time, since they act on the live usaurules.com worker and its database. Likewise, installing declared dependencies is routine but _adding_ a new one requires asking first.

The trust list lives in [`managed-settings.json`](managed-settings.json) and is baked into the image at `/etc/claude-code/managed-settings.json`, which the classifier reads as managed (org-wide) settings. To change it, edit that file and rebuild — `claude auto-mode config` inside the container will print the effective ruleset with `$defaults` expanded. The block-and-allow rules are inherited from the defaults; only `environment` is customized, so web research (docs, issues, reference implementations) is not restricted.

## Firewall

Egress is locked to a small allowlist: GitHub, the Anthropic API, the npm registry, VS Code Server hosts, the Cloudflare API, and the handful of hosts `wrangler dev` needs at runtime (Gemini, Google OAuth) plus stack documentation sites. To confirm it's active, `curl --connect-timeout 5 https://example.com` should fail and `curl --connect-timeout 5 https://api.github.com/zen` should succeed; if the first one returns content, the firewall didn't come up and `postStartCommand` output is the place to look.

The allowlist is built from DNS lookups at container start, so CDN-hosted services can become unreachable mid-session if their IPs rotate — run `sudo /usr/local/bin/init-firewall.sh` to refresh, or rebuild. The same refresh applies after editing `ALLOWED_DOMAINS` in [`init-firewall.sh`](init-firewall.sh): the running ipset reflects the resolution that happened at the last script invocation, so new entries don't take effect until you re-run the script (or rebuild the container, which runs it as part of `postStartCommand`).

The firewall is runtime-only and does not constrain `docker build`; tooling fetched during image build (git-delta, oh-my-zsh, plugins, Chromium's apt dependencies) trusts whatever the build step pulls in.
