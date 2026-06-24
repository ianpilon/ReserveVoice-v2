# ReserveVoice — free, near-Vapi voice agent (no Vapi)

A warm voice receptionist that takes restaurant reservations in the browser. Runs for ~$0.05/hour.

## Stack
- **Listen:** Silero VAD in-browser (free) carves each utterance → **Groq Whisper** (`whisper-large-v3-turbo`) transcribes it
- **Think:** **Groq** `llama-3.3-70b-versatile` (streamed) via a Cloudflare Worker
- **Speak:** **Groq Orpheus** TTS (`canopylabs/orpheus-v1-english`) via the Worker — hosted, so nothing downloads to the browser and the first visit is instant
- **Barge-in:** talk over the agent and it stops instantly
- **Backend:** one Cloudflare Worker (`worker/`) that hides the Groq key and serves `/chat` + `/stt` + `/tts`

The only browser-side libs load from CDN (see the `<script>` tags in `index.html`): `onnxruntime-web@1.22.0` and `@ricky0123/vad-web@0.0.29` (small). The Kokoro in-browser model is gone — TTS is now a hosted Groq call.

## Run / deploy

### Worker (the brain)
```bash
cd worker
npx wrangler login
npx wrangler secret put GROQ_API_KEY   # paste your free Groq key here — never in the repo
npx wrangler deploy                     # prints https://reservevoice-brain.<you>.workers.dev
```
Put that URL in `index.html` → `window.RESERVE_CONFIG.workerUrl`.

### Frontend
- Local test (Chrome): `python3 -m http.server 5500 --bind 127.0.0.1`, open http://127.0.0.1:5500
- Public: `git push` (GitHub Pages serves it at https://ianpilon.github.io/ReserveVoice/)

Click the button, allow the mic, talk. Loads instantly (only the small VAD model). Headphones recommended for cleanest barge-in.

## Tuning (all in `voice.js` unless noted)
- Persona / wording: `SYSTEM_PROMPT`, `GREETING` (in `voice.js`)
- Voice: `TTS_VOICE` in `worker/src/index.js` (`hannah`, `troy`, `austin`, …)
- Turn-end snappiness vs clipping: `redemptionFrames` in `loadVAD`
- Chat model / brevity: `CHAT_MODEL`, `max_tokens` in `worker/src/index.js`

## Not included (the one real Vapi gap)
Telephony — a real dialable phone number. This is web-mic only. To take phone calls, add Twilio Media Streams in front of the same Worker pipeline; the Worker is structured for it.
