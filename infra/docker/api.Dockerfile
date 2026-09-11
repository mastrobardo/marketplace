# The API image. Built exactly once per commit, by `deploy-staging.yml`, and promoted to production
# unchanged (ADR-006) — so this file decides what production runs, not just what staging runs.
#
# Build context is the repository root: the API depends on `packages/config` and
# `packages/contracts` through the workspace, so a context of `apps/api` alone cannot resolve them.

# ---- build ------------------------------------------------------------------------------------
FROM node:22.22.0-alpine AS build
WORKDIR /repo

RUN corepack enable

# Manifests and the lockfile first: this layer changes only when a dependency changes, so an
# ordinary code commit reuses the installed store instead of re-resolving 400 packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
#
# Every workspace member's manifest must be listed, not only the ones the API imports: pnpm
# resolves the lockfile against the whole workspace, and a member missing here is a member missing
# from the install. `tests/cd-workflows.test.ts` fails when a new one is not added.
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/testing/package.json packages/testing/
# The design system is a web package and the API image needs none of its code — but
# `pnpm install --frozen-lockfile` reads every workspace manifest, so a missing one fails the
# install layer rather than the runtime.
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# `--ignore-scripts` above skipped the root `prepare`, so both of its halves run explicitly here.
#
# `packages/contracts` is a *runtime* dependency of the API and is not bundled into `dist`
# (`skipNodeModulesBundle: true`), so its own `dist/` has to exist before the image is pruned —
# otherwise the container resolves `@marketplace/contracts` to a package with no entry point and
# crash-loops on boot, which reads only as a Fly health-check timeout.
RUN pnpm --filter @marketplace/config build \
    && pnpm --filter @marketplace/contracts build \
    && pnpm --filter @marketplace/api db:generate \
    && pnpm --filter @marketplace/api build

# Drop dev dependencies before they can be copied into the runtime stage.
#
# `--legacy` is required, not optional: from pnpm 10, `deploy` refuses a workspace that does not
# set `inject-workspace-packages=true`, and setting that would change how every developer's local
# install resolves workspace packages. The escape hatch is the smaller change.
RUN pnpm --filter @marketplace/api --prod deploy --legacy /pruned

# Regenerate the Prisma client *inside the pruned tree*.
#
# `pnpm deploy` rebuilds node_modules from the store, and the store holds the published
# `@prisma/client` — an empty shell whose real code is written by `prisma generate` into the
# installed package. So the client generated in /repo does not travel, and the pruned image gets a
# package that throws MODULE_NOT_FOUND on its first import.
#
# Nothing catches this today: no route touches the database yet, so the image boots and /health
# answers. The first slice that runs a query would have discovered it in production, on a deploy
# that passed every gate. Verified by `docker run … node -e "require('@prisma/client')"`.
RUN cd /pruned && /repo/apps/api/node_modules/.bin/prisma generate --schema /pruned/prisma/schema.prisma

# ---- runtime ----------------------------------------------------------------------------------
FROM node:22.22.0-alpine AS runtime
WORKDIR /srv

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

# Never root. A container that is compromised should not also be privileged inside itself.
RUN addgroup -S marketplace && adduser -S marketplace -G marketplace

COPY --from=build --chown=marketplace:marketplace /pruned/node_modules ./node_modules
COPY --from=build --chown=marketplace:marketplace /pruned/dist ./dist
# The migrations ship with the image so that `db:migrate:deploy` runs the exact set this build was
# tested with — not whatever `main` happens to hold when the release is approved.
COPY --from=build --chown=marketplace:marketplace /repo/apps/api/prisma ./prisma

USER marketplace
EXPOSE 8080

# No migrate-on-boot. Migrations are a separate, approved, observable step in the workflow; a
# container that migrates as it starts turns a bad migration into a crash-loop nobody can read.
CMD ["node", "dist/server.js"]
