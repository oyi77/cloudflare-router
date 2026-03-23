FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p /root/.cloudflare-router/nginx/sites \
    && mkdir -p /root/.cloudflare-router/tunnel \
    && mkdir -p /root/.cloudflare-router/mappings \
    && mkdir -p /root/.cloudflare-router/backups

EXPOSE 7070

ENV NODE_ENV=production

CMD ["node", "src/cli.js", "dashboard", "-p", "7070"]
