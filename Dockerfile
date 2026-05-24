# Stage 1 - build
FROM node:18-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production

# install deps
COPY package*.json ./
RUN npm ci --production=false

# copy source and build
COPY . .
RUN npm run build

# Stage 2 - runtime
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
# Koyeb sets $PORT at runtime; default to 8080 when not provided
ENV PORT=${PORT:-8080}

# copy built app and production deps
COPY --from=builder /app .

EXPOSE ${PORT}

# start Next.js production server on the provided port
CMD ["sh", "-c", "npx next start -p ${PORT}"]
