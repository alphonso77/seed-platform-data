FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS frontend-deps
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci

FROM frontend-deps AS frontend-build
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM deps AS backend-build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
