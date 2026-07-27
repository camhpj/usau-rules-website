FROM node:24-bookworm-slim

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest
ARG GIT_DELTA_VERSION=0.19.2
# Only decides which apt packages Chromium's runtime needs. The browser binary
# itself is downloaded by postCreateCommand at the version pinned in
# package.json, so this does not have to track it exactly.
ARG PLAYWRIGHT_VERSION=1.61.1

# Base packages + firewall tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
        aggregate \
        ca-certificates \
        curl \
        dnsutils \
        git \
        gnupg \
        iproute2 \
        ipset \
        iptables \
        jq \
        less \
        openssh-client \
        procps \
        sudo \
        unzip \
        vim \
        wget \
        zsh \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# git-delta for nicer diffs
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL -o /tmp/git-delta.deb \
        "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i /tmp/git-delta.deb && \
    rm /tmp/git-delta.deb

# Chromium's system libraries for Playwright. Only the OS-level dependencies are
# baked here; the browser build is fetched in postCreateCommand so it always
# matches @playwright/test in package.json instead of drifting from this image.
RUN apt-get update && \
    npx --yes playwright@${PLAYWRIGHT_VERSION} install-deps chromium && \
    rm -rf /var/lib/apt/lists/* /root/.npm

# Non-root user. UID 1000 is the conventional first user and keeps ownership
# sane on bind mounts from Linux hosts; the node image already ships a `node`
# user there, so retire it before claiming the ID.
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN userdel -r node 2>/dev/null || true && \
    groupadd --gid $USER_GID $USERNAME && \
    useradd --uid $USER_UID --gid $USER_GID -m -s /bin/zsh $USERNAME

# Claude Code — installed into a user-owned global prefix so auto-update can
# rename the package dir in place. Installing as root into /usr/lib/node_modules
# leaves the tree root-owned and breaks `claude update` for the dev user.
ENV NPM_CONFIG_PREFIX=/home/$USERNAME/.npm-global \
    PATH=/home/$USERNAME/.npm-global/bin:$PATH
RUN install -d -o $USERNAME -g $USERNAME /home/$USERNAME/.npm-global
USER $USERNAME
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
USER root

# Sudo only for the firewall script
RUN echo "$USERNAME ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" \
        > /etc/sudoers.d/$USERNAME-firewall && \
    chmod 0440 /etc/sudoers.d/$USERNAME-firewall

# Persisted shell history (named volume target)
RUN mkdir /commandhistory && \
    touch /commandhistory/.bash_history && \
    chown -R $USERNAME /commandhistory && \
    echo "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
        >> /home/$USERNAME/.bashrc

# Claude config dir (named volume target)
RUN mkdir -p /home/$USERNAME/.claude && \
    chown -R $USERNAME:$USERNAME /home/$USERNAME/.claude

# Named volume targets for the npm cache and Playwright's browser store, plus
# the parent for any other ~/.cache writer (VS Code Server writes ~/.cache/Microsoft).
# Pre-creating with dev ownership makes Docker preserve it when initializing the
# volume on first mount — otherwise the mount lands root-owned and unwritable.
RUN mkdir -p /home/$USERNAME/.npm /home/$USERNAME/.cache/ms-playwright && \
    chown -R $USERNAME:$USERNAME /home/$USERNAME/.npm /home/$USERNAME/.cache

# node_modules dir (named volume target). Lives inside the workspace but is
# masked by a volume so the Linux tree installed in the container doesn't bleed
# through the bind mount and collide with the host's macOS install — the
# platform-specific binaries (workerd, esbuild, rollup) are not interchangeable.
RUN install -d -o $USERNAME -g $USERNAME /workspace /workspace/node_modules

# oh-my-zsh + plugins for the dev user, with a baked-in .zshrc.
ENV ZSH=/home/$USERNAME/.oh-my-zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --keep-zshrc && \
    git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions $ZSH/custom/plugins/zsh-autosuggestions && \
    git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting $ZSH/custom/plugins/zsh-syntax-highlighting && \
    chown -R $USERNAME:$USERNAME $ZSH
COPY --chown=$USERNAME:$USERNAME zshrc /home/$USERNAME/.zshrc

# Firewall script
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

# Claude Code auto-mode trust config, installed as managed settings so it
# applies system-wide and survives the ~/.claude volume mount. Root-owned and
# read-only — the dev user inherits the rules but cannot edit them.
RUN mkdir -p /etc/claude-code
COPY managed-settings.json /etc/claude-code/managed-settings.json
RUN chmod 0644 /etc/claude-code/managed-settings.json

ENV DEVCONTAINER=true \
    EDITOR=vim \
    VISUAL=vim

USER $USERNAME
WORKDIR /workspace
