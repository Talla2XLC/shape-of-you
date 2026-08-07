FROM node:24-alpine AS web-build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @shape-of-you/web... --frozen-lockfile

COPY apps/web apps/web
ARG NUXT_PUBLIC_IDENTITY_ORIGIN=https://identity.staging.shape-of-you.ru
ENV NUXT_PUBLIC_IDENTITY_ORIGIN=$NUXT_PUBLIC_IDENTITY_ORIGIN
RUN pnpm --filter @shape-of-you/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --chown=nginx:nginx deploy/staging/nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY --chown=nginx:nginx deploy/staging/nginx/bootstrap.conf /etc/nginx/bootstrap.conf
COPY --chown=nginx:nginx deploy/staging/nginx/start-edge.sh /usr/local/bin/start-shape-of-you-edge
COPY --from=web-build --chown=nginx:nginx /workspace/apps/web/.output/public /usr/share/nginx/html

USER nginx
EXPOSE 8080 8081 8443

CMD ["/usr/local/bin/start-shape-of-you-edge"]
