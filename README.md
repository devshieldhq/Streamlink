# StreamLink XR

One service now, not two. The relay backend serves the website and the VR
app itself — no separate static host, no cross-origin server URL to type
into a lobby.

## Structure

```
streamlink-server/
  server.js        Relay backend — one isolated FFmpeg process per platform,
                    quality presets, auto-recovery, scheduling, real-time
                    telemetry, a multi-turn AI agent endpoint (Anthropic tool
                    use), and now: serves everything in public/ as static
                    files from this same process.
  package.json
  railway.json
  nixpacks.toml
  public/
    index.html, docs.html, contact.html, privacy.html, terms.html, style.css
                    The marketing site.
    streamlink-xr.html
                    The VR control room. Served at /app.
    streamlink-xr-logo.svg, streamlink-xr-mark.svg
                    Logo + favicon, used by both the site and the app.
```

## Why this structure specifically

Railway's Root Directory is set to `streamlink-server/`, and Railway only
copies what's *inside* the configured root directory into the build —
nothing from outside it exists in the deployed container. So the static
files live in `streamlink-server/public/`, not at the repo root one level
up. (An earlier version of this put them at repo root and relied on
`express.static(path.join(__dirname, '..'))` — that works locally but
silently fails on Railway specifically, for the reason above. Worth
knowing if you ever see this pattern elsewhere.)

## Running it

```bash
cd streamlink-server
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — enables the real AI agent
npm start
```

Everything is now on one origin:
- `/` — the marketing site (`public/index.html`)
- `/app` — the VR control room (`public/streamlink-xr.html`)
- `/docs.html`, `/contact.html`, etc. — the rest of the site
- `/platforms`, `/start`, `/stop/:id`, `/agent`, etc. — the API, called
  same-origin by `/app` now (no server-URL field in the lobby anymore)
- `/api/status` — health check (moved off `/`, since `/` now serves the
  website instead of a JSON status blob)

Open `/app` on the Quest browser over HTTPS — WebXR, the mic, and hand
tracking all require a secure context.

## Deploying

**Render**, not Railway — the Railway trial ran out. One service, one URL,
one place to look at logs, same as the Railway plan this replaced.

There's a `Dockerfile` in `streamlink-server/` now (installs ffmpeg at the
OS level, then runs the app) and a `render.yaml` Blueprint at the repo
root — Render requires the Blueprint file to live at repo root even though
`rootDir: streamlink-server` tells it which subfolder to actually build.

**Easiest path:** on [render.com](https://render.com), New → Blueprint →
connect this repo. It reads `render.yaml` and creates the service for you.
You'll be prompted to set `ANTHROPIC_API_KEY` (optional) since it's marked
`sync: false` — that just means "ask for this, don't commit it."

**Manual path**, if you'd rather not use a Blueprint: New → Web Service →
connect the repo → Root Directory: `streamlink-server` → Runtime: Docker
→ set `ANTHROPIC_API_KEY` in the Environment tab if you want the real
agent → Deploy.

**Worth knowing about the free tier:** a free Render web service spins
down after 15 minutes with no traffic and takes about a minute to wake
back up on the next request. Fine for a demo; if that cold start matters
for a real audience, Render's Starter plan ($7/mo) keeps it always on —
same Dockerfile, no code changes needed either way.

`railway.json` and `nixpacks.toml` are left in place and untouched — the
Dockerfile also works on Railway if you ever go back, so nothing here is
Render-specific lock-in.

If you still have the old Vercel project around, it's now serving a stale,
disconnected copy of the site — point your actual domain at the Render
deployment and retire the Vercel one, or it'll quietly drift out of sync
every time you update `public/`.

## The AI agent

Demo line, said in VR: **"Twitch dropped. Fix it and lower quality if
needed."** Watch the AGENT PIPELINE panel — it observes, reconnects,
observes again, decides whether quality needs to drop, and reports. Falls
back to a deterministic version of the same sequence without
`ANTHROPIC_API_KEY` set.

## Reconnect architecture

Each platform runs its own FFmpeg child process. Reconnecting one never
touches the others — see `doReconnectPlatform` and the process-identity
check in each process's `close` handler in `server.js`.

## Going live — what's real now, and how to verify it

Up to this point, pressing Start never actually sent video anywhere —
`/start` spun up FFmpeg processes waiting on stdin, and nothing fed them.
That's fixed: both `/live` (phone/laptop) and `/app` (VR) now capture the
camera and mic with `getUserMedia`, encode with `MediaRecorder`, and POST
chunks in order to `/stream/:sessionId`. I can't run a browser with a real
camera and a real platform key myself, so here's exactly how to confirm it
end-to-end rather than take it on faith:

1. Open `/live` (easier to debug than VR for a first try), enable the
   camera, add a real YouTube or Twitch key, press Go Live.
2. Watch the server's console (or Render's logs) for FFmpeg output —
   `frame=` lines appearing means it's actually encoding real frames, not
   sitting idle.
3. Check YouTube/Twitch's own live dashboard — it should show an incoming
   stream within a few seconds.
4. If nothing arrives: open the browser's dev tools Network tab and
   confirm POSTs to `/stream/...` are firing every ~1s and returning 200,
   not failing silently.

**Device reality, stated plainly:**
- `/live` works anywhere `getUserMedia` and `MediaRecorder` are supported
  — Android Chrome, desktop browsers, and the Quest browser all qualify.
- **iOS Safari is the known weak spot** — its `MediaRecorder` support for
  webm has historically been inconsistent. If an iPhone user hits
  problems, that's most likely why; worth testing directly rather than
  assuming it works.
- `/app`'s VR room only runs as an immersive session on WebXR-capable
  browsers (Quest). On a phone it was already falling back to a frozen,
  non-interactive 3D preview before this change — that part is inherent
  to WebXR, not something this update touches.

## Still placeholders

- **Sign-in / accounts** — doesn't exist yet. `/app` takes a free-text
  session ID and per-session stream keys typed into the lobby; nothing is
  saved between visits. Supabase (or similar) would be the natural choice
  if you want accounts that remember a user's platforms — that's new code
  to write (auth UI, a credentials table, server-side session
  verification), not a settings change.
- **Web3 creator identity** — UI only, in the VR app. Connects a wallet,
  shows the address, mints nothing.
- **Pricing tiers and the contact form** — `$0/$19/$49` and the "send
  message" button are both placeholders; the form just fakes a success
  state client-side (there's a comment marking exactly where to wire a
  real backend for it).
