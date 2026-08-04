FROM node:22-slim

# System deps for yt-dlp + ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg curl ca-certificates \
    && pip3 install --no-cache-dir yt-dlp --break-system-packages \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps
COPY package.json package-lock.json ./
RUN npm install --production

# Copy app code
COPY scripts/ ./scripts/
COPY .env.example ./

# Cloud Run provides PORT env var
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "scripts/web/server.mjs"]
