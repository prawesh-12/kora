# The Acme stand-in. Staging runs this; production points at the real business API.
FROM node:24-alpine AS base
RUN npm install --global pnpm@11.17.0 tsx@4.20.6
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @kora/mock-commerce...
# `--legacy`: the workspace does not set `inject-workspace-packages`, and pnpm 10+
# refuses a non-injected deploy without being told to.
RUN pnpm deploy --legacy --filter @kora/mock-commerce --prod /bundle

FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /bundle .
USER node
ENV NODE_ENV=production ACME_PORT=4001
EXPOSE 4001
CMD ["tsx", "src/index.ts"]
