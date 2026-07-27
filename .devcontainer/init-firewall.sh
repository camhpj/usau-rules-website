#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Preserve Docker's internal DNS rules before flushing.
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER 2>/dev/null || true
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    if ! echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat 2>/dev/null; then
        echo "WARNING: some Docker DNS rules failed to restore; DNS inside the container may be impaired" >&2
    fi
fi

# Pre-allowlist basics: loopback + DNS scoped to the configured resolver.
# SSH is intentionally NOT pre-allowed; git-over-SSH to GitHub flows through
# the allowed-domains ipset (which matches any port for those IPs).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

NAMESERVER=$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf)
if [ -z "$NAMESERVER" ]; then
    echo "ERROR: Failed to detect DNS resolver from /etc/resolv.conf" >&2
    exit 1
fi
iptables -A OUTPUT -p udp --dport 53 -d "$NAMESERVER" -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -d "$NAMESERVER" -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -s "$NAMESERVER" -j ACCEPT
iptables -A INPUT  -p tcp --sport 53 -s "$NAMESERVER" -m state --state ESTABLISHED -j ACCEPT

ipset create allowed-domains hash:net

echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -fsS https://api.github.com/meta)
if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: GitHub meta response missing required fields" >&2
    exit 1
fi
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR from GitHub meta: $cidr" >&2
        exit 1
    fi
    ipset add allowed-domains "$cidr" -exist
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | grep -E '^[0-9]+\.' | aggregate -q)

ALLOWED_DOMAINS=(
    "api.anthropic.com"
    "registry.npmjs.org"
    "marketplace.visualstudio.com"
    "update.code.visualstudio.com"
    "vscode.blob.core.windows.net"
    "downloads.claude.ai"
    # Cloudflare — the deploy target. wrangler talks to api.cloudflare.com for
    # auth, D1 and deploys; dash.cloudflare.com serves the OAuth flow for
    # `wrangler login`. Deploys and --remote D1 commands are gated behind
    # explicit confirmation in managed-settings.json, not by the firewall.
    "api.cloudflare.com"
    "dash.cloudflare.com"
    "usaurules.com"           # the deployed site
    # Runtime dependencies of `wrangler dev`. The worker's own outbound calls
    # leave from inside this container, so the AI features and Google sign-in
    # are unreachable in local dev without these.
    "generativelanguage.googleapis.com" # Gemini (Ask + Scenario)
    "accounts.google.com"     # Google OAuth authorize endpoint
    "oauth2.googleapis.com"   # Google OAuth token exchange
    "www.googleapis.com"      # Google userinfo
    "usaultimate.org"         # `npm run ingest -- --refetch` source HTML
    # Playwright browser downloads (postCreateCommand runs before the firewall
    # is up, but these are needed to re-run `npx playwright install` mid-session
    # or after bumping @playwright/test).
    "cdn.playwright.dev"
    "playwright.download.prss.microsoft.com"
    # Stack documentation. Each host is CDN-fronted so IPs can rotate
    # mid-session — rerun `sudo /usr/local/bin/init-firewall.sh` to refresh if
    # reads start failing.
    "svelte.dev"              # Svelte 5 + SvelteKit docs
    "developers.cloudflare.com" # Workers, D1, wrangler docs
    "orm.drizzle.team"        # Drizzle ORM + drizzle-kit docs
    "www.better-auth.com"     # better-auth docs
    "bits-ui.com"             # Bits UI component docs
    "tailwindcss.com"         # Tailwind CSS v4 docs
    "vite.dev"                # Vite docs
    "vitest.dev"              # vitest test-runner docs
    "playwright.dev"          # Playwright docs
    "www.typescriptlang.org"  # TypeScript docs
)

for domain in "${ALLOWED_DOMAINS[@]}"; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "ERROR: Failed to resolve $domain" >&2
        exit 1
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP for $domain: $ip" >&2
            exit 1
        fi
        ipset add allowed-domains "$ip" -exist
    done < <(echo "$ips")
done

# Allow host network (so VS Code Server can reach the container). Derive the
# actual connected subnet from the routing table rather than assuming /24.
HOST_NETWORK=$(ip -4 route show | awk '!/^default/ && /src/ {print $1; exit}')
if [ -z "$HOST_NETWORK" ]; then
    echo "ERROR: Failed to detect host network" >&2
    exit 1
fi
echo "Host network: $HOST_NETWORK"
iptables -A INPUT  -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Default deny.
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# Verify: blocked host should fail, allowed host should succeed.
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed — example.com is reachable" >&2
    exit 1
fi
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed — api.github.com is unreachable" >&2
    exit 1
fi
echo "Firewall configured successfully."
