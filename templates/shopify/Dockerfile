# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json ./
RUN pnpm install --no-frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user: this process holds live store credentials in memory.
RUN addgroup -S adapter && adduser -S adapter -G adapter

COPY --from=build --chown=adapter:adapter /app/node_modules ./node_modules
COPY --from=build --chown=adapter:adapter /app/dist ./dist
COPY --from=build --chown=adapter:adapter /app/package.json ./package.json

USER adapter
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/adapter.js"]
