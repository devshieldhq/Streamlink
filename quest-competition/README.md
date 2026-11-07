# StreamLink XR — Quest Competition Build

This is a deliberately isolated Meta Immersive Web SDK (IWSDK) application.

## Separation and safety

- This app lives in `quest-competition/` on its own Git branch.
- It does not replace the existing Three.js experience.
- It does not edit `streamlink-server/server.js`, the existing Node package, Supabase configuration, or StreamBot.
- It is intended to be built and hosted independently as a static Vite site.
- The existing StreamLink website and backend remain the production source of truth.

## Local development

Requirements: Node.js 20.19+ (or 22.12+).

```bash
cd quest-competition
npm install
npm run dev
```

Use the IWSDK emulator for desktop development, then validate the HTTPS deployment in Meta Quest Browser on a physical headset.

## Production build

```bash
npm run build
npm run preview
```

The static production site is generated in `dist/`.

## Current scope

This foundation establishes the IWSDK runtime, Quest 3 emulator configuration, hand-tracking feature request, locomotion/grabbing support, and a simple StreamLink studio scene. It is not yet a competition-ready submission. The next pass must add and test the hands-first creator workflow, spatial control UI, seated comfort/focus mode, and arena gameplay on a physical Quest headset.

## Separate Render deployment

Create a **Static Site** connected to this repository and branch `iwsdk-quest-competition`:

- Root Directory: `quest-competition`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

Do not change the existing StreamLink web service's root directory, build command, start command, or environment variables.

Official IWSDK setup: https://iwsdk.dev
Official Meta IWSDK source and starter: https://github.com/meta/immersive-web-sdk
