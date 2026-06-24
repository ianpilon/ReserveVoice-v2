# ReserveVoice

A browser-based AI voice receptionist that takes restaurant reservations by talking, with a live phone-mockup transcript that fills in as you speak. Built **without Vapi**, on a cheap, mostly-free stack.

**Live demo:** https://ianpilon.github.io/ReserveVoice-v2/ — click *Talk to the AI*, allow the mic, and book a table out loud.

> This is `v2` of ReserveVoice. The original Vapi-powered version lives at [ianpilon/ReserveVoice](https://github.com/ianpilon/ReserveVoice).

## How it works

A full voice loop assembled from parts, no single all-in-one platform:

| Stage | What runs it | Where |
|-------|-------------|-------|
| **Listen** | Silero VAD (turn detection) → **Groq Whisper** `whisper-large-v3-turbo` (transcription) | VAD in browser, Whisper via Worker |
| **Think** | **Groq** `llama-3.3-70b-versatile`, streamed | Worker |
| **Speak** | **Deepgram Aura-2** (`aura-2-arcas-en`) | Worker → browser plays it |
| **Orchestrate** | turn-taking, echo-verified barge-in, noise/phantom-word filtering | browser (`voice.js`) |

The only backend is a single **Cloudflare Worker** (`worker/`) that hides the API keys and exposes `/chat`, `/stt`, `/tts`. The frontend is static (GitHub Pages).

### Notable details
- **Instant load** — nothing heavy downloads to the browser (TTS is hosted), so the first visit is immediate, on desktop or phone.
- **Echo-verified barge-in** — you can talk over the agent; it ducks, checks that what it heard isn't its own voice echoing back, and only then stops. It never cuts itself off.
- **Live transcript** — the hero phone mockup shows the conversation as bubbles, synced to the agent's speech.
- **Honest by design** — the greeting discloses it's an AI assistant, and it says so plainly if asked.

## Cost
- **Groq** (transcription + LLM): free tier.
- **Deepgram** (voice): $200 free credit (~200+ hours of speech), then ~1.5¢ per 1k characters. No per-day cap.

## Run it yourself
See **[SETUP.md](SETUP.md)** for the full steps. In short:

```bash
cd worker
npx wrangler login
npx wrangler secret put GROQ_API_KEY       # console.groq.com (free)
npx wrangler secret put DEEPGRAM_API_KEY   # console.deepgram.com (free $200 credit)
npx wrangler deploy
```
Put the printed Worker URL into `index.html` (`window.RESERVE_CONFIG.workerUrl`), then `git push` to publish on GitHub Pages.

## Not included
Telephony — a real dialable phone number. This is web-mic only. To take actual phone calls, add Twilio Media Streams in front of the same Worker pipeline; everything is structured for it.
