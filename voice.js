// voice.js v7 — Vapi-grade-ish, near-free. Nothing heavy loads in the browser, so first visit is instant.
//   Listen : Silero VAD in-browser carves your utterance, Groq Whisper transcribes it
//   Think  : Groq LLM (streamed) via the Worker
//   Speak  : Groq Orpheus TTS via the Worker (hosted — no model download in the browser)
//   Barge-in: talk over the agent and it stops immediately
// Requires the onnxruntime-web + vad-web <script> tags in the HTML (global `vad.MicVAD`).

// ---- config ----
const BASE =
  (window.RESERVE_CONFIG && window.RESERVE_CONFIG.workerUrl) || "http://localhost:8787";
const CHAT_URL = BASE + "/chat";
const STT_URL = BASE + "/stt";
const TTS_URL = BASE + "/tts";
const LOG_URL = BASE + "/log";
const SYSTEM_PROMPT =
  "You are a warm, friendly host at The Copper Fork restaurant, taking a reservation over the phone. " +
  "Sound like a real person: relaxed and conversational, use contractions and natural phrasing, never robotic or clipped. " +
  "Keep each reply to one short sentence (about 12 words). Warmly acknowledge what they just said, then ask for the " +
  "next detail, one at a time, in this order: party size, date, time, name, phone number. " +
  "When you have all five, warmly confirm the booking in one sentence and wrap up. " +
  "If they speak after that, keep it brief and friendly. No lists, markdown, or stiff phrasing.";
const GREETING = "Copper Fork, how many in your party?";

// ---- state ----
const LABELS = { idle: "Talk to the AI in Your Browser", connecting: "Loading…", active: "End Call", error: "Try Again" };
let state = "idle";
let vadObj = null;
let micStream = null;
let history = [];
let callActive = false;
let agentSpeaking = false;
let processing = false;
let currentAudioEl = null;
let chatController = null;
let turnGen = 0;
let speakChain = Promise.resolve();
let agentSpeechText = ""; // what the agent is currently saying — used to tell real interruptions from echo

// ---- logging (console only; open DevTools or run RV_DUMP() to inspect timings) ----
let turn = null;
window.RV_LOG = [];
function beaconLog(msg) {
  try { fetch(LOG_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg }), keepalive: true }).catch(() => {}); } catch {}
}
function mark(stage) {
  const since = turn ? Math.round(performance.now() - turn.t0) : 0;
  window.RV_LOG.push({ stage, sinceYouStoppedMs: since });
  console.log(`[voice] +${since}ms  ${stage}`);
  beaconLog(`+${since}ms ${stage}`);
}
function logError(where, e) {
  console.error("[voice]", `ERROR @${where}:`, e && e.message ? e.message : e, e);
  beaconLog(`ERROR @${where}: ${e && e.message ? e.message : e}`);
}
window.RV_DUMP = () => console.table(window.RV_LOG);

function setState(s) {
  state = s;
  document.querySelectorAll(".vapi-call-btn").forEach((btn) => {
    btn.dataset.state = s;
    const label = btn.querySelector(".vapi-label");
    if (label) label.textContent = LABELS[s] || LABELS.idle;
  });
}

function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.start(t); o.stop(t + 0.14);
  } catch {}
}

// ---- Speak (Groq Orpheus TTS via Worker — nothing loads in the browser) ----
async function playSentence(text, gen) {
  if (gen !== turnGen || !text.trim()) return;
  let blob;
  try {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!res.ok) throw new Error("tts " + res.status);
    blob = await res.blob();
  } catch (e) { logError("tts", e); return; }
  if (gen !== turnGen) return; // barged-in while synthesizing
  const url = URL.createObjectURL(blob);
  const el = new Audio(url);
  currentAudioEl = el;
  agentSpeaking = true;
  el.onplaying = () => { if (turn && !turn.firstAudio) { turn.firstAudio = true; mark("first audio plays (you hear it)"); } };
  await new Promise((res) => { el.onended = el.onerror = res; el.play().catch(res); });
  URL.revokeObjectURL(url);
  if (currentAudioEl === el) { currentAudioEl = null; agentSpeaking = false; }
}
function enqueueSpeech(text, gen) { speakChain = speakChain.then(() => playSentence(text, gen)); return speakChain; }

function stopAgent() {
  turnGen++; // invalidate anything queued or playing
  if (chatController) { try { chatController.abort(); } catch {} chatController = null; }
  if (currentAudioEl) { try { currentAudioEl.pause(); currentAudioEl.src = ""; } catch {} currentAudioEl = null; }
  agentSpeaking = false;
}

// ---- Think (Groq LLM via Worker), streamed + chunked, abortable ----
async function think(text, gen) {
  history.push({ role: "user", content: text });
  agentSpeechText = ""; // reset; fills in as this reply streams
  chatController = new AbortController();
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history] }),
    signal: chatController.signal,
  });
  if (!res.ok || !res.body) throw new Error("chat " + res.status);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", sentence = "", full = "", firstTok = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done || gen !== turnGen) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const d = t.slice(5).trim();
      if (d === "[DONE]") continue;
      try {
        const delta = JSON.parse(d).choices?.[0]?.delta?.content || "";
        if (delta && !firstTok) { firstTok = true; mark("LLM first token (Groq replied)"); }
        sentence += delta; full += delta; agentSpeechText = full;
        if (/[.!?]["')\]]?\s*$/.test(sentence) && sentence.trim()) { enqueueSpeech(sentence, gen); sentence = ""; }
      } catch {}
    }
  }
  if (gen === turnGen && sentence.trim()) enqueueSpeech(sentence, gen);
  history.push({ role: "assistant", content: full });
  await speakChain;
  if (gen === turnGen) mark("done speaking (turn complete)");
}

// ---- Listen (VAD carves the clip → Groq Whisper transcribes) ----
function encodeWav(f32, rate = 16000) {
  const buffer = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buffer);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + f32.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, f32.length * 2, true);
  let off = 44;
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribe(f32) {
  const res = await fetch(STT_URL, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: encodeWav(f32) });
  if (!res.ok) throw new Error("stt " + res.status);
  return (await res.json()).text || "";
}

function unduck() { if (currentAudioEl) { try { currentAudioEl.volume = 1.0; } catch {} } }

// Is the heard text just the agent's own voice echoing back, rather than a real interruption?
function looksLikeEcho(userText, agentText) {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const u = norm(userText);
  if (u.length === 0) return true;
  const a = new Set(norm(agentText));
  const overlap = u.filter((w) => a.has(w)).length / u.length;
  return overlap >= 0.5; // half+ of the heard words are words the agent is currently saying → echo
}

function onSpeechStart() {
  // Speech detected. If the agent is talking, duck it (instant feedback + quiets echo) but don't
  // cut it yet — onSpeechEnd will verify whether it was really you or just the agent echoing.
  if (agentSpeaking && currentAudioEl) {
    try { currentAudioEl.volume = 0.18; } catch {}
    mark("possible interrupt — ducking");
  }
}

async function onSpeechEnd(f32) {
  if (f32.length < 16000 * 0.3) { unduck(); return; } // ignore <0.3s blips
  const duringAgent = agentSpeaking;
  const agentText = agentSpeechText;

  let text = "";
  turn = { t0: performance.now(), firstAudio: false };
  mark("got your audio, transcribing");
  try { text = await transcribe(f32); }
  catch (e) { logError("stt", e); unduck(); return; }

  // If the agent was speaking, was this really you or just its own voice echoing back?
  if (duringAgent && looksLikeEcho(text, agentText)) {
    unduck(); // false alarm — keep talking
    if (text.trim()) mark(`ignored echo: "${text}"`);
    return;
  }
  if (!text.trim()) { unduck(); return; }

  // Real turn (normal or a genuine barge-in): stop the agent and respond.
  stopAgent();
  const gen = turnGen;
  processing = true;
  mark(`heard you: "${text}"`);
  try { await think(text, gen); }
  catch (e) { if (!e || e.name !== "AbortError") logError("turn", e); }
  finally { processing = false; }
}

async function loadVAD() {
  if (!window.vad || !window.vad.MicVAD) throw new Error("vad global missing — CDN script not loaded");
  return window.vad.MicVAD.new({
    onSpeechStart,
    onSpeechEnd,
    stream: micStream,
    // tuning for a snappier, less twitchy feel:
    positiveSpeechThreshold: 0.7, // higher = quiet speaker echo is less likely to trip a (verified) interrupt
    negativeSpeechThreshold: 0.45,
    redemptionFrames: 10,         // silence frames before end-of-speech; higher avoids clipping trailing words on a pause
    minSpeechFrames: 3,           // ignore ultra-short blips
    preSpeechPadFrames: 2,
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/",
  });
}

// ---- call control ----
async function startCall() {
  setState("connecting");
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { logError("mic", e); setState("error"); return; }
  try { vadObj = await loadVAD(); } catch (e) { logError("vad", e); setState("error"); return; }

  callActive = true; history = []; turnGen = 0;
  setState("active");

  // Speak the greeting with the mic NOT yet listening, so the VAD can't trip and invalidate it.
  const gen = ++turnGen;
  await enqueueSpeech(GREETING, gen);
  history.push({ role: "assistant", content: GREETING });

  // Greeting done — now cue the caller and start listening.
  if (!callActive) return; // user may have hung up during the greeting
  beep();
  vadObj.start();
}

function endCall() {
  callActive = false;
  stopAgent();
  if (vadObj) { try { vadObj.pause(); } catch {} }
  if (micStream) { try { micStream.getTracks().forEach((t) => t.stop()); } catch {} micStream = null; }
  setState("idle");
}

async function handleClick() {
  if (state === "connecting") return;
  if (state === "active") return endCall();
  await startCall();
}

document.querySelectorAll(".vapi-call-btn").forEach((btn) => btn.addEventListener("click", handleClick));
