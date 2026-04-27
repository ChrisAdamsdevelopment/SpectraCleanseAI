FROM node:16-alpine

# Install Perl (required by exiftool-vendored)
RUN apk add --no-cache perl

WORKDIR /app

# Install dependencies first (caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Create required directories
RUN mkdir -p uploads /data

# Expose the port Hyperlift expects
EXPOSE 3001

# Start the backend
CMD ["node", "server.js"]
