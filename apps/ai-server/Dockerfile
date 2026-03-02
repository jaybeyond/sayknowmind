# AI Routing Server (NestJS) - v3 force rebuild
FROM node:20-alpine AS builder

WORKDIR /app

# Install packages (including devDependencies - needed for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy only built files
COPY --from=builder /app/dist ./dist

# Copy data files (knowledge, cascade, prompts, local-models)
COPY --from=builder /app/data ./data

# environment variable
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/main.js"]
