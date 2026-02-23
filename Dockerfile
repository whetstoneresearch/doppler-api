FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY README.md AGENT_INTEGRATION.md ./

RUN npm run build && npm prune --omit=dev

EXPOSE 3000
CMD ["npm", "run", "start"]
