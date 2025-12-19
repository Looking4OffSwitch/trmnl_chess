# Container image for TRMNL Chess (backend + static frontend)
FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY website/backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY website/backend/ ./

# Copy static frontend assets into /app/site
COPY website/site/ ../site/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
