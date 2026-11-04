# StreamBot setup

StreamBot is the built-in StreamLink XR assistant. Its chat widget is injected into the public HTML pages by the server, and all model requests stay server-side.

## Required deployment variables

Set these in the `streamlink-server` service environment (Render/Railway):

- `MODEL_API_KEY`: API key from the Groq Console. Keep it private; never add it to browser JavaScript or commit it.
- `GROQ_MODEL`: optional model override. Defaults to `llama-3.3-70b-versatile`.

After setting the key, redeploy/restart the service. The widget's status line should show **Online · Meta Llama connected**.

## Optional platform update feed

Set `STREAMBOT_UPDATES` to a JSON array of verified release notes. Example:

```json
[
  {
    "date": "2026-11-04",
    "title": "StreamBot is here",
    "summary": "StreamLink XR now includes its own Meta Llama-powered assistant."
  }
]
```

Update this value when a release is actually shipped. StreamBot reads it from the server environment and uses it when users ask for platform updates. An empty array means no published updates are available.

## Endpoints

- `GET /api/streambot/status` — provider configuration, server uptime, active session count and published updates.
- `POST /api/streambot/chat` — general platform support chat. Accepts `{ "message": "...", "history": [...] }`.
- `POST /agent` — signed-in voice/stream co-pilot with the existing stream-control tools.

The browser never receives the Groq API key. General support chat does not have stream-control tools; stream actions remain on the authenticated agent route.

## Notes

- The chat widget is loaded on the landing page, account/docs pages, Go Live page and VR page.
- Chat history is kept in the widget's page memory only; it is not persisted as a server-side conversation.
- Live status means the relay process status, not a guarantee that every external social platform is healthy.
- External platform comment imports, automated social monitoring and push notifications need their own official integrations and credentials.
- Never ask users to send passwords, stream keys, API keys or wallet recovery phrases to StreamBot.
