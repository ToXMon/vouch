# Build React in Docker to ensure reproducibility
FROM node:22-slim AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
RUN npm install -g vite@5.4.0
COPY frontend/ ./
RUN vite build

# Serve with nginx + API proxy
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
