# StreamLink XR backend and same-origin IWSDK Quest Studio.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Build the Quest experience into the Express public directory so /quest
# shares this service's HTTPS origin, auth configuration, and backend APIs.
RUN npm --prefix quest-competition install \
 && npm --prefix quest-competition run typecheck \
 && npm --prefix quest-competition run build

EXPOSE 3000
CMD ["node", "server.js"]
