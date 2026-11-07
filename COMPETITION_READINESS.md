# Meta VR Start Developer Competition 2026 — StreamLink XR Readiness

## Eligibility checklist

The official rules require the entrant (or every team member, where applicable) to:
- Be at least 18 and the age of majority in their jurisdiction.
- Have an active Meta account with Developer Access enabled by submission.
- Have the submitting representative be a member in good standing of Meta VR Start by submission.
- Reside in an eligible location and satisfy the banking / sanctions restrictions in the official rules.
- Submit only one entry as an individual or team representative.

Kenya is not named among the excluded locations in the competition rules. Entrant eligibility still depends on the individual requirements above.

Before submission, the entrant must personally confirm: age requirement, Developer Access status, Start membership in good standing, Devpost registration, and correct individual/team representative status.

## Recommended project positioning

- Project: StreamLink XR — a hands-first spatial creator studio for controlling and monitoring live broadcasts, with an original in-world VR Arena.
- Track recommendation: Productivity. The primary product is a creator workspace; Arena is an interactive onboarding / engagement mode. The sponsor can reassign track placement.
- Division recommendation: Adapted / Significantly Updated Experience, because StreamLink existed before the competition window and this entry adds a substantial IWSDK Quest build, hands-first spatial controls, and Arena gameplay during the window. The sponsor makes the final significance determination.
- Originality: The core spatial workspace and Arena remain useful without third-party streaming destinations or the AI agent. Those services extend the project; they are not the entire project.

## Submission requirements

- A working IWSDK/WebXR URL that judges can open and test; this project is hosted on the existing StreamLink domain.
- A public demonstration video under 3 minutes, showing actual Quest / XR Simulator / equivalent emulator footage.
- Devpost project name, 140-character tagline, track, division, inspiration, implementation approach, future plans, and target launch date.
- For an adapted project, a clear summary of the new competition-window features, with screenshots / changelog / video recommended.
- Describe hands-first interactions and what is exciting about future VR (optional field).
- Keep the project free and accessible through the winner announcement (December 11, 2026).
- Submission deadline: November 18, 2026 at 12:00 PM Pacific (11:00 PM East Africa Time).

## Technical acceptance checklist

### Automated checks
- [ ] TypeScript typecheck passes.
- [ ] IWSDK production build passes.
- [ ] Docker image builds with the nested Quest build step.
- [ ] Express serves /quest/ and redirects /app to /quest/.
- [ ] Existing /config.js, Supabase auth, platform credentials, stream APIs, FFmpeg and Socket.IO remain functional.

### XR / gameplay checks
- [ ] Run the IWSDK development server with `cd streamlink-server/quest-competition && npm install && npm run dev`; use the injected IWER Quest 3 emulator to enter XR and test hands / pointers on desktop.
- [ ] Quest Browser opens the app over HTTPS and enters immersive VR.
- [ ] Hands are available without pairing controllers.
- [ ] Pinch and poke operate every in-world control.
- [ ] Control panel can be grabbed and repositioned.
- [ ] Arena starts, spawns five targets, scores +10 per hit, counts down from 45 seconds, stops cleanly, and can restart.
- [ ] Seated use works within a comfortable reach / narrow field of view.
- [ ] Focus, Comfort and Reset controls work.
- [ ] Start / Stop, quality, destination entry and telemetry are tested end-to-end.
- [ ] Pause / resume and session exit do not leave camera, microphone, stream or timer resources running.
- [ ] Measure frame rate on Quest; target at least 60 FPS.
- [ ] Confirm free, reliable judge access without requiring a developer login or private invitation.

Important: A successful desktop CI build does not prove headset hand tracking, comfort, frame rate, or end-to-end streaming. Those require XR emulator and/or physical Quest validation.