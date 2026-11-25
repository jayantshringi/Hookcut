FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/yt-bridge.mjs ./scripts/yt-bridge.mjs

ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

CMD ["node", "scripts/yt-bridge.mjs"]
