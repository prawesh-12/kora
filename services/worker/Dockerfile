# The BullMQ worker: evaluation, ingestion and the maintenance schedules.
FROM node:24-alpine AS base
RUN npm install --global pnpm@11.17.0 tsx@4.20.6
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @kora/worker...
# `--legacy`: the workspace does not set `inject-workspace-packages`, and pnpm 10+
# refuses a non-injected deploy without being told to.
RUN pnpm deploy --legacy --filter @kora/worker --prod /bundle

FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /bundle .
COPY --chown=node:node config ./config

# `@kora/ai` and `@kora/evaluation` read `config/` relative to their own source
# directory, which lines up only inside the workspace. In a deployed bundle each
# package sits under a `node_modules` of its own, so `config` is linked beside it.
RUN for dir in /app/node_modules/.pnpm/*/node_modules; do ln -sfn /app/config "$dir/config"; done

USER node
ENV NODE_ENV=production
CMD ["tsx", "src/index.ts"]
