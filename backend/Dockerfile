FROM node:22-alpine

WORKDIR /app

# Salin definisi dependensi
COPY package.json package-lock.json ./

# Instal dependensi (termasuk tsx untuk eksekusi server TypeScript)
RUN npm install

# Salin kode sumber backend
COPY . .

# Pastikan folder data tersedia
RUN mkdir -p /app/data

# Default environment variables
ENV NODE_ENV=production \
    SIGAP_HOST=0.0.0.0 \
    SIGAP_PORT=8787 \
    SIGAP_DB_PATH=data/sigap.db \
    SIGAP_AGENT_PROVIDER=gemini

EXPOSE 8787

CMD ["npm", "start"]
