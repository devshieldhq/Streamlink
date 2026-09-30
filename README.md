# StreamLink XR — Complete Package

Everything built so far, in one place: the relay backend, the VR/WebXR
frontend, the logo, and the marketing website.

## Contents

```
streamlink-server/       Relay backend — one isolated FFmpeg process per
                          platform, quality presets, auto-recovery,
                          scheduling, real-time telemetry, and a multi-turn
                          AI agent endpoint (Anthropic tool use).
streamlink-xr.html       The Quest/WebXR control room frontend. Self-
                          contained, no build step.
streamlink-xr-logo.svg   Full logo lockup (mark + wordmark).
streamlink-xr-mark.svg   Icon-only mark (favicon / app icon).
streamlink-website/      Marketing site (index, docs, contact, privacy,
                          terms) — see "Known gap" below before publishing.
```

## Running the backend + VR frontend

```bash
cd streamlink-server
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — see below
npm start
```

Serve `streamlink-xr.html` over HTTPS and open it on the Quest browser.
Demo line once you're in: **"Twitch dropped. Fix it and lower quality if
needed."** — watch the AGENT PIPELINE panel work through observe → act →
observe → decide → report. Without `ANTHROPIC_API_KEY`, `/agent` falls back
to a deterministic version of the same sequence.

## Reconnect architecture

Each platform now runs its own FFmpeg child process. `/reconnect/:sessionId/:platform`
genuinely restarts only that platform — every other platform's process is
untouched throughout. See `streamlink-server/server.js` for the isolation
logic (`doReconnectPlatform`, and the process-identity check in each
process's `close` handler that stops a deliberate restart from being
misread as an unexpected drop).

## Web3 creator identity

Optional, secondary. The lobby toggle in `streamlink-xr.html` is labeled
"experimental, UI only, no contract calls yet" — that's accurate, not a
hedge. Nothing is minted on-chain.

## `streamlink-website/` — rebuilt, not just rebranded

Two passes have gone into this site now. The first was a find-and-replace
rebrand (StreamHub → StreamLink XR). The second, more recent one rebuilt
the design and copy properly:

**Visual system replaced.** The old site ran three competing fonts
(Orbitron, Space Mono, Syne), glowing blurred "blob" backgrounds, a noise
texture overlay, scroll-triggered fade-ins on every section, matching
lift-and-glow hover states on every card, a "MOST POPULAR" diagonal
ribbon, checkmark-in-circle bullets, and an auto-scrolling logo marquee —
recognizable defaults, not choices made for this product. It now uses the
same two fonts, palette, and restraint as the VR app and the logo (Space
Grotesk for headings, Inter for everything else, violet/green accents
used only where they mean something), with motion limited to what
actually responds to a person doing something.

**Copy corrected, not just restyled.** The old copy described a
different, unbuilt product — a browser dashboard relaying to "8
platforms" via a local RTMP server, configured by pointing OBS at
`localhost:1935`. None of that is what StreamLink XR is. The hero,
features, "how it works" steps, and the entire `docs.html` page (setup,
platform table, ingest URLs, quality presets, agent commands) now
describe the actual VR headset flow and the real backend API — including
per-platform ingest URLs and quality presets pulled directly from
`server.js`'s own constants, so the docs won't drift out of sync with the
code silently.

**Deliberately left alone:** the pricing tiers ($0/$19/$49) and legal
boilerplate in `privacy.html`/`terms.html` are unverified business
content, not implementation details — I didn't invent numbers or policy
positions on your behalf. Confirm those are what you actually want to
charge and commit to before publishing.
