# ReserveVoice — free, near-Vapi voice agent (no Vapi)

A warm voice receptionist that takes restaurant reservations in the browser. Runs for ~$0.05/hour.

## Stack
- **Listen:** Silero VAD in-browser (free) carves each utterance → **Groq Whisper** (`whisper-large-v3-turbo`) transcribes it
- **Think:** **Groq** `llama-3.3-70b-versatile` (streamed) via a Cloudflare Worker
- **Speak:** **Kokoro** (`kokoro-js`) text-to-speech, in-browser (free)
- **Barge-in:** talk over the agent and it stops instantly
- **Backend:** one Cloudflare Worker (`worker/`) that hides the Groq key and serves `/chat` + `/stt`

The browser-side libs load from CDN (see the `<script>` tags in `index.html`): `onnxruntime-web@1.22.0`, `@ricky0123/vad-web@0.0.29`, and `kokoro-js`.

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

Click the button, allow the mic, talk. First load downloads the Kokoro + VAD models once. Headphones recommended for cleanest barge-in.

## Tuning (all in `voice.js` unless noted)
- Persona / wording: `SYSTEM_PROMPT`, `GREETING`
- Voice: `VOICE` (`af_heart`, `af_bella`, `bm_george`, …)
- Speech pace: `el.playbackRate` in `playSentence`
- Turn-end snappiness vs clipping: `redemptionFrames` in `loadVAD`
- Chat model / brevity: `CHAT_MODEL`, `max_tokens` in `worker/src/index.js`

## Not included (the one real Vapi gap)
Telephony — a real dialable phone number. This is web-mic only. To take phone calls, add Twilio Media Streams in front of the same Worker pipeline; the Worker is structured for it.
