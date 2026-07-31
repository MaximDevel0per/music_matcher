# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# 1. Bauen
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# WICHTIG: Vite ersetzt import.meta.env.* beim BAUEN durch feste Strings.
# Die API-Adresse muss deshalb hier feststehen, sie lässt sich später nicht
# mehr per Umgebungsvariable ändern.
#
# "/api" ist ein relativer Pfad: das Frontend spricht immer denselben Host an,
# von dem es geladen wurde. nginx leitet /api an das Backend weiter. Dadurch
# gibt es keine fremde Origin — und damit gar keine CORS-Frage.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Ausliefern
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
