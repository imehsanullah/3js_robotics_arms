FROM node:24-bookworm-slim

WORKDIR /app

ENV npm_config_update_notifier=false

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--port", "5173"]
