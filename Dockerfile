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
    && fc-cache -f

COPY package*.json ./

RUN npm ci --only=production

COPY . .

# Dynamic port from build args or runtime environment
ARG PORT=3000
ENV NODE_ENV=production
ENV PORT=${PORT}

EXPOSE ${PORT}

CMD ["node", "src/index.js"]
