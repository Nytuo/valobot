FROM node:22-alpine

WORKDIR /app

# Install native dependencies required for canvas, native modules and system fonts
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    fontconfig \
    ttf-dejavu \
    font-noto \
    font-freefont \
    tzdata \
    su-exec \
    && fc-cache -f

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The entrypoint fixes ownership of the data volume, then drops to the unprivileged "node" user
RUN mkdir -p /app/data && chown -R node:node /app/data \
    && sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Dynamic port from build args or runtime environment
ARG PORT=3000
ENV NODE_ENV=production
ENV PORT=${PORT}

EXPOSE ${PORT}

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
