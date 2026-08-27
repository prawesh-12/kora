# The Next.js app. Built on webpack, because the `@kora/*` packages ship
# TypeScript that imports itself with `.js` specifiers and only webpack's
# `extensionAlias` understands that.
FROM node:24-alpine AS base
RUN npm install --global pnpm@11.17.0
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter web...

# `next build` reads the environment through `serverEnv()`, which insists on a
# database and a Redis URL. These are placeholders for the build only; the
# container reads the real ones at start.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    NODE_ENV=production
RUN pnpm --filter web exec next build --webpack

# `--legacy`: the workspace does not set `inject-workspace-packages`, and pnpm 10+
# refuses a non-injected deploy without being told to.
RUN pnpm deploy --legacy --filter web --prod /bundle && \
    rm -rf /bundle/.next && cp -r /repo/apps/web/.next /bundle/.next && \
    rm -rf /bundle/.next/cache

# `next.config.ts` imports dotenv and is loaded again by `next start`, but dotenv
# is a dev dependency and `--prod` drops it. It has no dependencies of its own.
RUN cp -rL "$(node -p "require('node:path').dirname(require.resolve('dotenv/package.json', { paths: ['/repo/apps/web'] }))")" /bundle/node_modules/dotenv

FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /bundle .

# The webpack build bakes `import.meta.dirname` in as the absolute path it was
# compiled from, and `@kora/ai` and `@kora/evaluation` read `config/` relative to
# it. Keeping the build path means those reads still resolve at runtime.
COPY --from=build --chown=node:node /repo/config /repo/config

USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
