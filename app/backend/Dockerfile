FROM node:22-bookworm-slim AS build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY otel/package.json otel/package-lock.json /opt/otel/
RUN npm ci --prefix /opt/otel --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000 DB_PATH=/var/lib/toko/toko.db
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /opt/otel/node_modules /opt/otel/node_modules
COPY server.js db.js ./
COPY otel/instrumentation.cjs otel/sqlite.cjs /opt/otel/
RUN mkdir -p /var/lib/toko
EXPOSE 3000
CMD ["node", "server.js"]
