# --- STAGE 1: Install dependencies ---
FROM node:20-slim AS deps
WORKDIR /app
COPY eil-dashboard/package*.json ./
RUN npm ci

# --- STAGE 2: Build Next.js app ---
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY eil-dashboard/ ./
RUN npm run build

# --- STAGE 3: Production runtime for Cloud Run ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

EXPOSE 8080
CMD ["npm", "run", "start", "--", "-p", "8080", "-H", "0.0.0.0"]