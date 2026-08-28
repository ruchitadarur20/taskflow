FROM node:22-alpine AS runtime

WORKDIR /app

RUN addgroup -S taskflow && adduser -S taskflow -G taskflow

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src

RUN chown -R taskflow:taskflow /app

USER taskflow

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
