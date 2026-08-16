FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package manifests
COPY package.json ./

# Install dependencies if any
RUN npm install --omit=dev --ignore-scripts || true

# Copy source code and assets
COPY src/ ./src/
COPY bin/ ./bin/
COPY skills/ ./skills/
COPY templates/ ./templates/
COPY test/ ./test/

# Create persistent storage directories
RUN mkdir -p /app/data /app/member/kb /app/member/reportes /app/member/exportaciones

# Expose port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/overview || exit 1

# Start server
CMD ["node", "src/server/index.js"]
