FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p /root/.cloudflare-router/nginx/sites \
     && mkdir -p /root/.cloudflare-router/tunnel \
     && mkdir -p /root/.cloudflare-router/mappings \
     && mkdir -p /root/.cloudflare-router/backups

EXPOSE ${DASHBOARD_PORT:-7070}

ENV NODE_ENV=production
ENV DASHBOARD_PORT=${DASHBOARD_PORT:-7070}

CMD ["node", "src/cli.js", "dashboard", "-p", "${DASHBOARD_PORT:-7070}"]
