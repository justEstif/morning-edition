# The Morning Edition — node server (adapter-node), deployed on dokku.
# Pinned base for reproducible builds; no secrets in this image.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY svelte.config.js vite.config.js ./
COPY src ./src
COPY static ./static
COPY scripts ./scripts
COPY data/demo ./data/demo

RUN npm run build

# production env only for the running server (dev deps are needed at build time)
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

EXPOSE 3000
CMD ["node", "build"]
