# StreamLink XR

A VR control room for the StreamLink multistream engine — hand-first
interaction, live platform status, a visible AI agent pipeline, and an
optional (secondary) Web3 creator identity layer.

## What's in this drop

- `streamlink-server/` — the relay backend. One isolated FFmpeg process
  *per platform* (see "Reconnect architecture" below), quality presets,
  auto-recovery, scheduling, a clip buffer, real-time telemetry, and a
  multi-turn `/agent` endpoint.
- `streamlink-xr.html` — the Quest/WebXR frontend, one self-contained file.

## Running it

```bash
cd streamlink-server
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — see "The AI agent"
npm start
```

Serve `streamlink-xr.html` over HTTPS (WebXR/mic need a secure context;
`localhost` is exempt but a real headset on your network isn't — `ngrok
http 8080` or a static deploy both work). Open the HTTPS URL on the Quest
browser.

## 1. The AI agent is now visible, not just a chatbot

The demo line to say once you're in VR:

> "Twitch dropped. Fix it and lower quality if needed."

What happens, and what you'll see on the new **AGENT PIPELINE** panel
(bottom-left) as it happens, line by line:

```
🎙 "Twitch dropped. Fix it and lower quality if needed."
💭 Let me check what's going on with Twitch first.
🔍 checking stream health…
✓ check_stream_health done
💭 Twitch is down — reconnecting it now.
⚙ reconnecting twitch…
✓ reconnect_platform done
🔍 checking stream health…
✓ check_stream_health done
⚙ setting quality to medium…
✓ set_quality done
🗣 Twitch is back online. Bitrate was weak, so I lowered quality to medium.
```

This is a real multi-turn tool-use loop against Claude (`/agent` on the
backend), not one tool call: the model observes state with
`check_stream_health`, decides, acts (`reconnect_platform`), **observes
again** to check whether the reconnect actually fixed the bitrate, and only
then decides whether `set_quality` is warranted — reporting a single final
summary at the end. Each step streams to the VR client over Socket.IO as it
happens, which is what makes the pipeline visible in real time instead of
only showing up as a finished chat reply.

Without `ANTHROPIC_API_KEY`, `/agent` runs a deterministic fallback that
performs the *same* observe → act → observe → decide → report sequence for
this exact command (and a few others), so the demo still works with no key
configured — it emits the identical `agentStep` events, it's just not an
LLM doing the deciding. The HTTP response includes `"fallback": true` when
that path is used, and the panel doesn't distinguish visually — worth
knowing if a judge asks whether it's "really" the model.

## 2. Web3 stays secondary

The lobby toggle is now labeled "experimental, UI only, no contract calls
yet," and that's an accurate description, not a hedge — connecting a
wallet shows a truncated address on a small panel and nothing else. I'd
hold off making this a headline claim until there's an actual contract or
subgraph behind the "Streams" / "Achievements" placeholders on that panel.

## 3. Reconnect architecture — fixed

**The problem:** the old backend ran a single FFmpeg process per session,
fanning one input out to N outputs (`-map 0` repeated per platform inside
one process). `/reconnect/:sessionId/:platform` looked like a per-platform
action but actually killed and restarted *that whole process* — every
platform's stream blipped, not just the one that dropped.

**The fix:** each platform now gets its **own** FFmpeg child process
(`session.processes[platformName]`), all fed the same incoming bytes at
the Node level (`/stream/:sessionId` writes to every process's stdin).
Consequences:

- `doReconnectPlatform` kills and respawns exactly one process. The others
  are never touched — verified by identity-checking the process object in
  the `close` handler, so a deliberate restart doesn't get misread as an
  unexpected drop and double-trigger auto-recovery.
- Per-platform stderr is genuinely per-platform now (each process only
  ever carries one platform's output), so `connecting` / `live` / `error`
  detection no longer depends on substring-matching a shared log stream —
  it's just "did this process's own stderr say so."
- `doSetQuality` now restarts each platform's encoder independently in
  sequence, instead of blacking out every platform simultaneously.
- Auto-recovery counters (`reconnectCounts`) are now per-platform, so one
  flaky platform hitting its retry cap doesn't affect the others' retry
  budget.

Trade-off worth knowing: N platforms now means N FFmpeg processes decoding
the same input independently, which costs more CPU than one process with
N outputs. For a demo or a handful of platforms this is a non-issue; if
you're running all 12 simultaneously on constrained hardware, that's the
number to watch.

## Demo script (~2 minutes)

1. **Lobby** — platform list pulls live from `/platforms`; fill in 2–3 real
   stream keys, hit Enter.
2. **Control room** — point out the platform cards, AI co-pilot bubble, the
   new agent pipeline panel, and the stats readout.
3. **Hands** — grab a platform card, pinch START.
4. **The agent, on camera** — say the Twitch line above and let the pipeline
   panel fill in step by step. This is the moment that shows an agent, not
   a chatbot.
5. **Isolation proof** (optional but convincing) — while live, manually kill
   just one platform's stream key server-side or unplug its target, and
   show the other platforms' cards stay green throughout the reconnect.
6. **Web3 (optional, brief)** — tap the creator panel, connect a wallet,
   move on quickly; it's not the headline.

## What's still a placeholder

- Stream keys are typed into the lobby by hand — no OAuth per platform yet.
- The Web3 layer is UI-only; nothing is minted on-chain.
- The anomaly detector is a rolling bitrate threshold on the *inbound*
  feed (browser → server), not per-platform egress health and not ML —
  it's an honest proxy, not a full diagnostic.
