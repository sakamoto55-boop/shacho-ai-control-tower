FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts
FROM node:22-bookworm-slim
ENV NODE_ENV=production DIOS_RUNTIME_MODE=cloud-pilot LCC_COMMAND_MODE=production ENABLE_DEV_ENDPOINTS=false
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docs/lcc-command-vui.html ./docs/lcc-command-vui.html
COPY --chown=node:node docs/vendor ./docs/vendor
COPY --chown=node:node docs/dios ./docs/dios
USER node
EXPOSE 8080
CMD ["node","dist/dios-cloud.js"]
