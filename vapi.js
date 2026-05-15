const PUBLIC_KEY = "c7d496d8-e4fb-44fe-9ffe-755d41ae32c3";
const ASSISTANT_ID = "2a12201f-7617-4955-a3ae-a6efde915a9b";

const LABELS = {
    idle: "Talk to the AI in Your Browser",
    connecting: "Connecting...",
    active: "End Call",
    error: "Try Again"
};

let vapi = null;
let state = "idle";

function setState(newState) {
    state = newState;
    document.querySelectorAll(".vapi-call-btn").forEach(btn => {
        btn.dataset.state = newState;
        const label = btn.querySelector(".vapi-label");
        if (label) label.textContent = LABELS[newState] || LABELS.idle;
    });
}

async function loadVapi() {
    if (vapi) return vapi;
    const mod = await import("https://cdn.jsdelivr.net/npm/@vapi-ai/web/+esm");
    const candidates = [
        mod.default,
        mod.Vapi,
        mod.default && mod.default.default,
        mod.default && mod.default.Vapi
    ];
    let Vapi = null;
    for (const c of candidates) {
        if (typeof c === "function") { Vapi = c; break; }
    }
    if (!Vapi) {
        console.error("Vapi constructor not found. Module shape:", mod);
        throw new TypeError("Vapi constructor not found in module");
    }
    vapi = new Vapi(PUBLIC_KEY);
    vapi.on("call-start", () => setState("active"));
    vapi.on("call-end", () => setState("idle"));
    vapi.on("error", (e) => {
        console.error("Vapi error:", e);
        setState("error");
    });
    return vapi;
}

async function handleClick() {
    if (state === "connecting") return;
    if (state === "active") {
        if (vapi) vapi.stop();
        return;
    }
    try {
        setState("connecting");
        const v = await loadVapi();
        await v.start(ASSISTANT_ID);
    } catch (err) {
        console.error("Vapi start error:", err);
        setState("error");
    }
}

document.querySelectorAll(".vapi-call-btn").forEach(btn => {
    btn.addEventListener("click", handleClick);
});
