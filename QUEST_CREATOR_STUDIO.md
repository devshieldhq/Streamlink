# Quest Creator Studio — StreamLink XR

## Competition concept
A seated, hands-first virtual workspace for creators who need to manage a live broadcast without leaving their creator workflow. The experience is designed for Meta Quest Browser and uses WebXR hand tracking.

## Implemented experience
- Seated control-room layout with reachable stream panels and controls.
- One-pinch Seated Comfort mode that scales and pulls the workspace closer; Reset restores the original panel layout.
- VR Focus Mode hides secondary panels and quality controls while keeping platform status, stream controls, and the focus toggle visible.
- VR Gaming Arena adds a 45-second target challenge with hand/controller pointing or pinch selection, five glowing targets, live score updates, and a replayable round.
- Hand tracking requested as a required immersive-session feature.
- Thumb/index pinch selection using fingertip raycasting.
- Pinch-and-hold panel movement with a preserved grab offset.
- Controller selection as an alternate input path when available.
- Explicit ENTER VR step after camera and microphone setup.
- Multi-platform destination status cards.
- Start/stop streaming and five quality presets.
- Live bitrate, uptime, and reconnect telemetry.
- StreamBot copilot with a visible agent activity pipeline.
- Optional signed-in creator passport.
- Camera/microphone tracks released when the immersive session ends or page exits.

## Demo flow
1. Open /app on Meta Quest Browser over HTTPS.
2. Select the session and quality preset.
3. Configure only the destination(s) used in the demo; do not display or speak stream keys.
4. Approve camera and microphone access, then select ENTER VR.
5. Demonstrate hands-first pinch selection and panel repositioning.
6. Show Seated Comfort mode and its Reset behavior.
7. Show Focus Mode and explain how it reduces workspace clutter.
8. Play the VR Arena round, show scoring and the retained final timer, then replay.
9. Only show live streaming after an end-to-end destination test succeeds on the Quest headset.

StreamBot is intentionally excluded from this competition demo flow while its Meta model integration is being repaired.
## Claims and limitations
- External comments are not automatically imported unless an official platform API/webhook is configured.
- Cross-platform social moderation is not yet an implemented in-room action.
- Creator Passport displays account-linked wallet and broadcast information; it does not mint NFTs or tokens.
- Real Quest headset validation is pending: hand tracking, pinch reliability, seated reach, camera/microphone permissions, and actual destination delivery.
- Platform credentials must be entered only in the secure platform fields; never share stream keys in StreamBot chat.

## Practical verification checklist
- [ ] Quest Browser opens the HTTPS app and requests hand tracking.
- [ ] Both hands can pinch-select START, TALK, and quality controls.
- [ ] Panels can be moved without jumping or becoming unreachable.
- [ ] The experience is comfortable while seated.
- [ ] Camera and microphone permissions work on the target headset.
- [ ] A test broadcast reaches the configured destination.
- [ ] StreamBot can inspect the session and execute a supported recovery action.