FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci
COPY . .
# Build the backend (tsc -b) and the dashboard (vite -> web/dist, served by the backend
# via @fastify/static, so one Fly app serves both API and UI).
# --force on the server build: never trust a stale .tsbuildinfo (would skip emit -> MODULE_NOT_FOUND).
RUN npm run build --workspace server -- --force
RUN npm run build --workspace web
ENV NODE_ENV=production
CMD ["node", "server/dist/index.js"]
