FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/identity/package.json apps/identity/package.json
RUN pnpm install --filter @shape-of-you/identity... --frozen-lockfile

COPY apps/identity apps/identity
RUN pnpm --filter @shape-of-you/identity build
RUN pnpm --filter @shape-of-you/identity --prod deploy /deploy

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /deploy /app
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
