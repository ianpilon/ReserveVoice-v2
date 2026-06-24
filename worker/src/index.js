// ReserveVoice "brain" — Cloudflare Worker. Hides your Groq key and serves two routes:
//   POST /chat  → Groq LLM (streamed reply)
//   POST /stt   → Groq Whisper (transcribe a WAV clip the browser recorded)
// This is the only backend. Structured so Twilio telephony can be added later.
//
// Deploy:  cd worker && npx wrangler deploy
// Secret:  npx wrangler secret put GROQ_API_KEY

const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_STT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TTS = "https://api.groq.com/openai/v1/audio/speech";
const CHAT_MODEL = "llama-3.3-70b-versatile";      // follows brevity + sounds more natural; ~200ms slower than 8b
const STT_MODEL = "whisper-large-v3-turbo";        // ~$0.04/hr, far better accuracy than browser STT
const TTS_MODEL = "canopylabs/orpheus-v1-english"; // Groq's current TTS (expressive); voices: troy, hannah, austin, …
const TTS_VOICE = "hannah";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

    const path = new URL(req.url).pathname;
    if (path === "/stt") return handleSTT(req, env);
    if (path === "/tts") return handleTTS(req, env);
    return handleChat(req, env); // default + "/chat"
  },
};

async function handleChat(req, env) {
  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400, headers: CORS }); }

  const r = await fetch(GROQ_CHAT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: body.messages,
      stream: true,
      temperature: 0.4,
      max_tokens: 40,
    }),
  });
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers: CORS });
  return new Response(r.body, { headers: { ...CORS, "Content-Type": "text/event-stream" } });
}

async function handleTTS(req, env) {
  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400, headers: CORS }); }
  const r = await fetch(GROQ_TTS, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, input: body.text || "", voice: body.voice || TTS_VOICE, response_format: "wav" }),
  });
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers: CORS });
  return new Response(r.body, { headers: { ...CORS, "Content-Type": "audio/wav" } });
}

async function handleSTT(req, env) {
  const buf = await req.arrayBuffer(); // raw WAV bytes from the browser
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
  fd.append("model", STT_MODEL);
  fd.append("response_format", "json");
  fd.append("language", "en");

  const r = await fetch(GROQ_STT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: fd,
  });
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers: CORS });
  const j = await r.json();
  return new Response(JSON.stringify({ text: j.text || "" }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
