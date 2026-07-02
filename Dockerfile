FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY config.json ./

RUN npm install -D typescript ts-node @types/node && \
    npm run build && \
    npm prune --omit=dev

CMD ["node", "dist/index.js"]
