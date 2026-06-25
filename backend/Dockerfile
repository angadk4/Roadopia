# Backend dev image (M0-T09). Build context is the repo root (see compose `context: ..`).
# Self-contained: installs the workspace from the lockfile, runs the Fastify dev server.
# The production multi-stage build lands at M12.
# Node 24 (not 20): pnpm 11.8 uses a node: builtin absent in Node 20 → install fails there.
FROM node:24-alpine

# husky's `prepare` script must not run inside the image (no .git here).
ENV HUSKY=0

# pnpm via corepack (version pinned by the root `packageManager` field).
RUN corepack enable

WORKDIR /app

# Install deps from manifests + lockfile first (better layer caching on source edits).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/
COPY eval/package.json ./eval/
RUN pnpm install --frozen-lockfile

# Source (host node_modules/.git/etc. excluded via .dockerignore).
COPY . .

WORKDIR /app/backend
EXPOSE 8080

# Dev: hot-reload via `tsx watch` (compose mounts ./backend/src for live edits).
CMD ["pnpm", "dev"]
