const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("q");
const sendBtn = document.getElementById("send");
const engineSel = document.getElementById("engine");
document.getElementById("year").textContent = new Date().getFullYear();

// Engines laden
fetch("/api/engines").then(r => r.json()).then(list => {
  engineSel.innerHTML = "";
  list.forEach(e => {
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.available ? e.label : e.label + " (Schluessel fehlt)";
    o.disabled = !e.available;
    engineSel.appendChild(o);
  });
}).catch(() => {});

function clearWelcome(){ const w = chat.querySelector(".welcome"); if (w) w.remove(); }

function addMsg(role, text){
  const m = document.createElement("div");
  m.className = "msg " + role;
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  m.appendChild(b);
  chat.appendChild(m);
  chat.scrollTop = chat.scrollHeight;
  return m;
}

function addSources(m, sources){
  if (!sources || !sources.length) return;
  const s = document.createElement("div");
  s.className = "sources";
  sources.forEach(src => {
    const c = document.createElement("span");
    c.className = "src";
    c.textContent = "📄 " + src;
    s.appendChild(c);
  });
  m.appendChild(s);
}

async function ask(question){
  clearWelcome();
  addMsg("user", question);
  const typing = addMsg("bot", "");
  typing.classList.add("typing");
  typing.querySelector(".bubble").innerHTML = '<span class="dot">●</span><span class="dot">●</span><span class="dot">●</span>';
  sendBtn.disabled = true;
  try{
    const res = await fetch("/api/ask", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ question, engine: engineSel.value || "local" })
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok){ addMsg("bot", "⚠️ " + (data.error || "Fehler")); return; }
    const m = addMsg("bot", data.answer);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "Engine: " + data.engine;
    m.appendChild(meta);
    addSources(m, data.sources);
  }catch(err){
    typing.remove();
    addMsg("bot", "⚠️ Verbindungsfehler: " + err.message);
  }finally{
    sendBtn.disabled = false;
    chat.scrollTop = chat.scrollHeight;
  }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  input.value = "";
  ask(q);
});

document.addEventListener("click", e => {
  if (e.target.classList.contains("chip")) ask(e.target.dataset.q);
});

// --- Status-Banner: zeigt laufende Indexierung im Dashboard ---
(function(){
  let banner;
  function ensure(){
    if (!banner){
      banner = document.createElement("div");
      banner.className = "idx-banner";
      banner.style.display = "none";
      const hdr = document.querySelector("header.topbar");
      hdr.insertAdjacentElement("afterend", banner);
    }
    return banner;
  }
  async function poll(){
    try{
      const s = await fetch("/api/status").then(r => r.json());
      const b = ensure();
      b.textContent = "⏳ Indexierung läuft… " + (s.detail || "");
      b.style.display = s.indexing ? "block" : "none";
    }catch(e){}
  }
  setInterval(poll, 3000); poll();
})();
