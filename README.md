# StreamLink XR

**One control room. Every platform. A world of play.**

StreamLink XR brings live streaming, gaming and immersive VR experiences together in one place. Creators can manage their streaming setup, step into the VR Arena, and connect with their community without jumping between a pile of separate tools.

[Open StreamLink XR](https://streamlink-xr.onrender.com/) · [Explore the VR Arena](https://streamlink-xr.onrender.com/quest/) · [Follow on X](https://x.com/StreamLink145)

---

## Step inside

StreamLink is being built for people who create, play and bring communities together.

- **VR Arena** — enter an immersive arena and experience first-person gameplay.
- **Creator Studio** — manage your streaming setup from a dedicated control space.
- **Hands-first controls** — use Quest hand tracking and pinch gestures to interact with the VR interface.
- **Go Live** — prepare and manage broadcasts from the web or VR experience.
- **Gamey** — a way for players without a VR headset to join the gaming experience.
- **Community spaces** — chat rooms and creator-focused features are part of the wider StreamLink experience.

## Built for the headset and the desktop

StreamLink XR is designed to work across different ways of playing and creating.

| Experience | What it is |
| --- | --- |
| Web platform | The main StreamLink website and creator entry points |
| VR Arena | An immersive WebXR experience for supported headsets |
| Creator Studio | A hands-first workspace for streaming controls |
| Gamey | A desktop-friendly route into gaming |

For the immersive experience, use a WebXR-capable browser on a supported headset. On Meta Quest, open the VR Arena over HTTPS and allow the permissions requested by the browser.

## Try it

- Website: https://streamlink-xr.onrender.com/
- VR Arena: https://streamlink-xr.onrender.com/quest/
- X: https://x.com/StreamLink145

Some features depend on browser support, account setup, connected platform credentials and service configuration. Streaming to an external platform should be tested with that platform's own live dashboard before a broadcast is treated as confirmed.

## Run the server locally

The relay server requires Node.js 18 or newer.

```bash
cd streamlink-server
npm install
npm start
```

The server listens on the port provided by the hosting environment. For local development, configure the environment variables your setup needs before starting the service.

### Environment configuration

Set configuration values in your hosting provider's environment settings. Common settings include:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the account experience.
- `REQUIRE_SIGN_IN` to control whether a signed-in account is required for protected streaming actions.
- `MODEL_API_KEY` only if you choose to enable the optional StreamBot assistant.

**Never commit API keys, service-role keys, stream keys or other secrets to this repository.**

## Hosting

The project includes a Render Blueprint at the repository root. To deploy:

1. Create a new Blueprint on [Render](https://render.com/).
2. Connect this repository.
3. Review the service settings from `render.yaml`.
4. Add the required environment values in the Render dashboard.
5. Deploy and check the service health endpoint at `/api/status`.

## Project layout

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

The server serves the web experience and relay endpoints. The Quest project contains the immersive experience and its IWSDK-based application code.

## Current development

StreamLink XR is actively being developed. The VR Arena, hands-first interaction and streaming workflow are being tested and improved across desktop browsers and Meta Quest. Browser permissions, headset compatibility and external platform delivery can vary, so please report issues with the device, browser and steps that led to them.

## Contributing

Ideas, bug reports and thoughtful contributions are welcome. Before opening a pull request:

1. Explain the change and the problem it solves.
2. Keep credentials and private configuration out of commits.
3. Test the affected experience on the device or browser it targets.
4. Include clear steps to reproduce any reported issue.

## A note on creator wallets

The account experience includes wallet linking through a signed message. Linking a wallet does not transfer funds, create a token, mint an NFT or deploy a smart contract.

---

**StreamLink XR — Play. Stream. Connect.**
