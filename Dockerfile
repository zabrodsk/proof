FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY migrations ./migrations
COPY scripts ./scripts
COPY shared ./shared
COPY public ./public
RUN PROOF_MODEL_DIR=/app/models npm run model:prepare
RUN npm run build
ENV NODE_ENV=production PROOF_HOSTED=true PROOF_USE_KEYCHAIN=false \
    PROOF_MODEL_DIR=/app/models PROOF_EMBEDDINGS=true \
    PROOF_EMBEDDING_REVISION=ea104dacec62c0de699686887e3f920caeb4f3e3
RUN mkdir -p /app/.data && chown node:node /app/.data && chown -R node:node /app/models
CMD ["sh", "-c", "if [ \"$PROOF_PROCESS\" = worker ]; then exec runuser -u node -- npm run worker; fi; chown node:node /app/.data && exec runuser -u node -- npm start"]
