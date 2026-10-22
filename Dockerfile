FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY package.json ./
# Diretório dos anexos com STORAGE_DRIVER=local (monte um volume aqui).
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
# Só a API, com DATABASE_URL do papel rotagest_app. As migrations rodam antes,
# num job à parte com as credenciais do dono (docs/DEPLOY.md):
#   docker run --rm -e DIRECT_DATABASE_URL=... -e DATABASE_URL=... -e APP_DB_PASSWORD=... <imagem> npm run db:deploy
CMD ["node", "dist/main.js"]
