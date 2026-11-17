# StreamLink XR

**Play. Stream. Connect.**

StreamLink XR brings gaming, live streaming and immersive VR together in one platform.

[Website](https://streamlink-xr.onrender.com/) · [VR Arena](https://streamlink-xr.onrender.com/quest/) · [X](https://x.com/StreamLink145)

## Features

- **VR Arena** — immersive first-person gameplay for supported headsets.
- **Creator Studio** — a dedicated space for managing streaming controls.
- **Hand tracking** — interact with the VR interface using Quest hand tracking and pinch gestures.
- **Go Live** — prepare and manage broadcasts from supported browsers.
- **Gamey** — desktop-friendly gaming access.
- **Community** — chat rooms and social features.

## Getting started

### Requirements

- Node.js 18 or newer for the relay server.
- A modern browser for the web platform.
- A WebXR-compatible headset and browser for immersive VR.

### Run locally

```bash
cd streamlink-server
npm install
npm start
```

Configure the environment variables required by your setup before starting the server.

## Configuration

Set environment values in your hosting provider. Depending on the features you use, these may include:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `REQUIRE_SIGN_IN`
- `MODEL_API_KEY` (optional)

Keep API keys, service-role keys, stream keys and other secrets out of source control.

## Deployment

The repository includes a Render Blueprint in `render.yaml`.

1. Create a Blueprint on [Render](https://render.com/).
2. Connect this repository.
3. Review the service configuration.
4. Add the required environment variables.
5. Deploy and check `/api/status`.

## Project structure

```text
.
├── render.yaml
├── supabase/
└── streamlink-server/
    ├── server.js
    ├── Dockerfile
    ├── public/
    └── quest-competition/
        └── src/
```

## Development status

StreamLink XR is under active development. Features and device support may vary by browser, headset and service configuration. Verify external broadcasts through the destination platform's own live dashboard.

## Contributing

Bug reports and contributions are welcome. Include clear reproduction steps, test relevant changes, and never commit private credentials.

## Wallet linking

Wallet linking uses a signed message. It does not transfer funds or create tokens, NFTs or smart contracts.

---

**StreamLink XR** — One control room. Every platform.
