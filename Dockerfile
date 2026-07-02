FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm install -D typescript ts-node @types/node && \
    npm run build && \
    npm prune --omit=dev

CMD ["node", "dist/index.js"]
