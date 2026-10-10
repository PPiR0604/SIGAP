# Multi-stage build untuk Frontend React + Vite
# Tahap 1: Build static assets
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

# Tahap 2: Serving menggunakan Nginx yang ringan
FROM nginx:alpine

# Salin output build ke direktori Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Salin konfigurasi Nginx dengan reverse proxy ke backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
