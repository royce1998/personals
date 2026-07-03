# Personals — production image
# Node 24 ships the built-in node:sqlite module (no native build tools needed).
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
