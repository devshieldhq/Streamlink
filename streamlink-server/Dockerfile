# Portable container for the StreamLink relay backend — works on Render,
# Fly.io, DigitalOcean App Platform, or Railway (Railway accepts Dockerfiles
# too, if you ever come back). Installs ffmpeg at the OS level, which is the
# one thing a plain Node buildpack won't give you for free.

FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Render (and most platforms) inject PORT at runtime; server.js already
# reads process.env.PORT with a fallback, so nothing to change there.
EXPOSE 3000

CMD ["node", "server.js"]
