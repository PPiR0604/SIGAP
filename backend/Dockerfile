FROM node:22-alpine

WORKDIR /app

# OCR stays local: Indonesian/English recognition and bounded PDF page rendering.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-ind tesseract-ocr-data-eng poppler-utils

# Salin definisi dependensi
COPY package.json package-lock.json ./

# Instal dependensi (termasuk tsx untuk eksekusi server TypeScript)
RUN npm ci

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
