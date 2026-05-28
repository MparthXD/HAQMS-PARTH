# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependency specifications and Prisma schema first
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies (needed to run Prisma generation)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# --- Runner Stage ---
FROM node:18-alpine AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy Prisma schema and migrations (necessary for running migrations in production)
COPY prisma ./prisma/

# Copy application source code
COPY src ./src/

# Expose Express server port
EXPOSE 5000

# Start command
CMD ["npm", "run", "start"]
