# syntax=docker/dockerfile:1
# Build from monorepo root:
#   docker build -f packages/uni-resolver-driver-did-peranto/Dockerfile \
#     -t ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0 .

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/uni-resolver-driver-did-peranto/package.json packages/uni-resolver-driver-did-peranto/

RUN npm ci --workspace=@peranto/sdk --workspace=@peranto/uni-resolver-driver-did-peranto --include-workspace-root=false \
  || npm install --workspace=@peranto/sdk --workspace=@peranto/uni-resolver-driver-did-peranto

COPY packages/sdk packages/sdk
COPY packages/uni-resolver-driver-did-peranto packages/uni-resolver-driver-did-peranto
COPY packages/web/public/deployments/paseo.json packages/uni-resolver-driver-did-peranto/deployments/paseo.json

RUN npm run build -w @peranto/sdk \
 && npm run build -w @peranto/uni-resolver-driver-did-peranto

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV PERANTO_NETWORK=paseo
ENV PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/
ENV PERANTO_DEPLOYMENT_PATH=/app/packages/uni-resolver-driver-did-peranto/deployments/paseo.json

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/sdk/package.json ./packages/sdk/
COPY --from=build /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build /app/packages/uni-resolver-driver-did-peranto/package.json ./packages/uni-resolver-driver-did-peranto/
COPY --from=build /app/packages/uni-resolver-driver-did-peranto/dist ./packages/uni-resolver-driver-did-peranto/dist
COPY --from=build /app/packages/uni-resolver-driver-did-peranto/deployments ./packages/uni-resolver-driver-did-peranto/deployments

EXPOSE 8080
WORKDIR /app/packages/uni-resolver-driver-did-peranto
CMD ["node", "dist/server.js"]
