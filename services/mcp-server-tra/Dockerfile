# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @borjie/mcp-server-tra.
# MIT-licensed throughout. Node 20 base image.

# ---------- Stage 1: Build (MIT) -----------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /build
COPY package.json tsconfig.json ./
COPY src/ ./src/

RUN npm install --no-audit --no-fund \
 && npx tsc

# ---------- Stage 2: Runtime ---------------------------------------------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /build/dist /app/dist
COPY --from=build /build/node_modules /app/node_modules
COPY package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3110
EXPOSE 3110

USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
