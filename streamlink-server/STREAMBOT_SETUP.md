# StreamBot setup

StreamBot is the built-in StreamLink XR assistant. Its chat requests are sent from the server; the model API key is never exposed to browser JavaScript.

## Required deployment variables

Set these in the `streamlink-server` service environment (Render/Railway):

- `MODEL_API_KEY`: your Meta API key. Keep it private; never add it to browser JavaScript or commit it.
- `META_MODEL`: optional model override. Defaults to `muse-spark-1.3`.

After setting the key, redeploy/restart the service and test `GET /api/streambot/status` and a message in StreamBot. The interface identifies the assistant as **StreamBot** and does not display a model-vendor label.

## Optional platform update feed

Set `STREAMBOT_UPDATES` to a JSON array of verified release notes. Example:

```json
[
  {
    "date": "2026-11-04",
    "title": "StreamLink XR Creator Studio",
    "summary": "A new hands-first Quest workspace is in development."
  }
]
```

Only publish updates after the feature is actually shipped. StreamBot reads this value from the server environment when users ask for platform updates.

## Endpoints

- `GET /api/streambot/status` — assistant configuration, server uptime, active session count and published updates.
- `POST /api/streambot/chat` — general platform support chat.
- `POST /agent` — signed-in voice/stream co-pilot with stream-control tools.

The browser never receives the model API key. General support chat does not have stream-control tools; stream actions remain on the authenticated agent route.

## Notes

- The chat widget is loaded on the landing page, account/docs pages, Go Live page and VR page.
- Chat history is kept in the widget's page memory only; it is not persisted as a server-side conversation.
- Live status means the relay process status, not a guarantee that every external social platform is healthy.
- External platform comment imports, automated social monitoring and push notifications need their own official integrations and credentials.
- Never ask users to send passwords, stream keys, API keys or wallet recovery phrases to StreamBot.
