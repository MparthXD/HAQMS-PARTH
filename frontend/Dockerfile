# --- Dependency Stage ---
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Build Stage ---
FROM node:18-alpine AS builder
WORKDIR /app

# Accept build-time API base URL argument
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NODE_ENV=production

# Copy dependencies and source files
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

# Build production assets
RUN npm run build

# --- Runner Stage ---
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary production files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

# Expose standard port
EXPOSE 3000

# Start command
CMD ["npm", "run", "start"]
