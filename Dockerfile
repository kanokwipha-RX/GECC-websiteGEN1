FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/var/files && chown -R node:node /app
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0 PORT=8080 FILE_ROOT=/app/var/files
EXPOSE 8080
CMD ["node", "server/index.js"]
