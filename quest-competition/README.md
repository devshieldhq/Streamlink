# StreamLink XR — Quest Competition Build

This is a deliberately isolated Meta Immersive Web SDK (IWSDK) application.

## Separation and safety

- This app lives in `quest-competition/`; it does not replace the existing Three.js page.
- It does not edit `streamlink-server/server.js`, the existing Node package, Supabase configuration, or StreamBot.
- It is built and hosted independently as a static Vite site.
- The existing StreamLink website and backend remain the production source of truth.

## Local development

Requirements: Node.js 20.19+ (or 22.12+).

```bash
cd quest-competition
npm install
npm run dev
```

Use the IWSDK emulator in desktop development, then validate the HTTPS deployment in Meta Quest Browser on a physical headset.

## Production build

```bash
npm run build
npm run preview
```

The static production site is generated in `dist/`.

## Current scope

The first isolated pass establishes the IWSDK runtime, Quest 3 emulator configuration, hand-tracking feature request, locomotion/grabbing systems, and a simple StreamLink studio scene. It is a foundation, not yet a competition-ready submission. Next passes must add and test the competition gameplay/creator workflow, spatial UI, accessibility/seated comfort, and actual Quest device behavior.

Official setup: https://developers.meta.com/vr/documentation/iwsdk/guides/01-project-setup/
Official build/deploy: https://developers.meta.com/vr/documentation/iwsdk/guides/08-build-deploy/
