const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("q");
const sendBtn = document.getElementById("send");
const engineSel = document.getElementById("engine");
const newBtn = document.getElementById("newchat");
const tabbar = document.getElementById("chattabs");
document.getElementById("year").textContent = new Date().getFullYear();

// Engines laden
fetch("/api/engines").then(r => { if (r.status === 401){ location.href = "login.html"; return []; } return r.json(); }).then(list => {
  engineSel.innerHTML = "";
  list.forEach(e => {
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.available ? e.label : e.label + " (Schluessel fehlt)";
    o.disabled = !e.available;
    if (e.default && e.available) o.selected = true;
    engineSel.appendChild(o);
  });
}).catch(() => {});

// --- Minimaler Markdown-Renderer (offline, ohne externe Libs) ---
function escapeHtml(s){
  return s.replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
}
function renderInline(s){
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function renderMarkdown(src){
  const blocks = [];
  src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return ` BLOCK${blocks.length - 1} `;
  });
  const lines = escapeHtml(src).split("\n");
  let html = "", list = null;
  const closeList = () => { if (list){ html += `</${list}>`; list = null; } };
  for (let raw of lines){
    const line = raw.replace(/ BLOCK(\d+) /g, (_, i) => blocks[i]);
    if (/^ BLOCK\d+ $/.test(raw)){ closeList(); html += line; continue; }
    let m;
    if ((m = line.match(/^\s*###\s+(.*)/))){ closeList(); html += `<h3>${renderInline(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*##\s+(.*)/))){ closeList(); html += `<h2>${renderInline(m[1])}</h2>`; }
    else if ((m = line.match(/^\s*#\s+(.*)/))){ closeList(); html += `<h2>${renderInline(m[1])}</h2>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))){ if (list !== "ul"){ closeList(); html += "<ul>"; list = "ul"; } html += `<li>${renderInline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))){ if (list !== "ol"){ closeList(); html += "<ol>"; list = "ol"; } html += `<li>${renderInline(m[1])}</li>`; }
    else if (line.trim() === ""){ closeList(); html += ""; }
    else { closeList(); html += `<p>${renderInline(line)}</p>`; }
  }
  closeList();
  return html;
}

// ===================== Tab-Verwaltung =====================
// Ablage PRO NUTZER (Benutzername im Key), damit niemand die Chats eines anderen
// Nutzers sieht, wenn man sich im selben Browser ab- und wieder anmeldet.
let STORE_KEY = "rag_chat_tabs_v1";
let tabs = [];        // [{id, title, messages:[{role,text,sources,engine}]}]
let activeId = null;
let busy = false;     // true waehrend eines laufenden Streams

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function activeTab(){ return tabs.find(t => t.id === activeId); }

function loadTabs(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && Array.isArray(raw.tabs) && raw.tabs.length){
      tabs = raw.tabs; activeId = raw.active && tabs.some(t => t.id === raw.active) ? raw.active : tabs[0].id;
      return;
    }
  }catch(e){}
  tabs = [{ id: uid(), title: "Neuer Chat", messages: [] }];
  activeId = tabs[0].id;
}
function saveTabs(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify({ tabs, active: activeId })); }catch(e){}
}
function tabTitle(t){
  const firstUser = t.messages.find(m => m.role === "user");
  if (!firstUser) return "Neuer Chat";
  const s = firstUser.text.trim().replace(/\s+/g, " ");
  return s.length > 26 ? s.slice(0, 26) + "…" : s;
}

function renderTabs(){
  tabbar.innerHTML = "";
  tabs.forEach(t => {
    const el = document.createElement("div");
    el.className = "chattab" + (t.id === activeId ? " active" : "");
    el.title = tabTitle(t);
    const label = document.createElement("span");
    label.className = "chattab-label"; label.textContent = tabTitle(t);
    el.appendChild(label);
    const close = document.createElement("button");
    close.type = "button"; close.className = "chattab-close"; close.innerHTML = "&times;";
    close.title = "Diesen Chat schliessen";
    close.addEventListener("click", e => { e.stopPropagation(); closeTab(t.id); });
    el.appendChild(close);
    el.addEventListener("click", () => switchTab(t.id));
    tabbar.appendChild(el);
  });
  const add = document.createElement("button");
  add.type = "button"; add.className = "chattab-add"; add.innerHTML = "&#10010;";
  add.title = "Neuer Chat";
  add.addEventListener("click", newTab);
  tabbar.appendChild(add);
}

const WELCOME = '<div class="welcome"><h1>Frag deine Dokumente</h1>' +
  '<p>Stelle eine Frage zu deinen internen Unterlagen. Die Antwort wird ausschliesslich aus den hinterlegten Quellen erzeugt &ndash; und bleibt lokal.</p>' +
  '<div class="examples">' +
  '<button class="chip" data-q="Wie oft werden die Server gesichert und wie lange werden Backups aufbewahrt?">Backup-Intervall?</button>' +
  '<button class="chip" data-q="Welche Schritte gibt es beim Onboarding eines neuen Kunden?">Kunden-Onboarding?</button>' +
  '<button class="chip" data-q="Wie werden Angebote erstellt?">Angebotserstellung?</button>' +
  '</div></div>';

function renderChat(){
  chat.innerHTML = "";
  const t = activeTab();
  if (!t || !t.messages.length){ chat.innerHTML = WELCOME; return; }
  t.messages.forEach(m => {
    const el = renderMessage(m.role, m.text);
    if (m.role === "bot"){
      if (m.engine){ const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = "Engine: " + m.engine; el.appendChild(meta); }
      addSources(el, m.sources);
    }
  });
  chat.scrollTop = chat.scrollHeight;
}

function renderMessage(role, text){
  const m = document.createElement("div");
  m.className = "msg " + role;
  const b = document.createElement("div");
  b.className = "bubble";
  if (role === "bot") b.innerHTML = renderMarkdown(text);
  else b.textContent = text;
  m.appendChild(b);
  chat.appendChild(m);
  return m;
}

function addSources(m, sources){
  if (!sources || !sources.length) return;
  m.querySelectorAll(".sources").forEach(e => e.remove());
  const s = document.createElement("div");
  s.className = "sources";
  sources.forEach(it => {
    const src = typeof it === "string" ? it : it.source;
    const score = (it && typeof it === "object") ? it.score : null;
    const pages = (it && typeof it === "object") ? (it.pages || (it.page ? [it.page] : [])) : [];
    const name = src.split("/").pop();
    const a = document.createElement("a");
    a.className = "src";
    a.href = "/api/document?source=" + encodeURIComponent(src) + (pages.length ? "#page=" + pages[0] : "");
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = "📄 " + name + (pages.length ? " · S. " + pages.join(", ") : "");
    a.title = src + (pages.length ? "  ·  Seite " + pages.join(", ") : "") + (score != null ? `  ·  Relevanz ${Math.round(score * 100)}%` : "");
    s.appendChild(a);
  });
  m.appendChild(s);
}

function switchTab(id){
  if (busy || id === activeId) return;
  activeId = id; saveTabs(); renderTabs(); renderChat();
}
function newTab(){
  if (busy) return;
  const t = { id: uid(), title: "Neuer Chat", messages: [] };
  tabs.push(t); activeId = t.id; saveTabs(); renderTabs(); renderChat();
  input.focus();
}
function closeTab(id){
  if (busy) return;
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (!tabs.length){ tabs.push({ id: uid(), title: "Neuer Chat", messages: [] }); }
  if (activeId === id){ activeId = tabs[Math.max(0, idx - 1)].id; }
  saveTabs(); renderTabs(); renderChat();
}

// ===================== Fragen / Streaming =====================
async function ask(question){
  const t = activeTab();
  if (!t) return;
  // Verlauf (Multi-Turn) aus den bisherigen Nachrichten dieses Tabs
  const sentHistory = t.messages.map(m => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));

  // Welcome entfernen, Nutzerfrage anzeigen + speichern
  const w = chat.querySelector(".welcome"); if (w) w.remove();
  t.messages.push({ role: "user", text: question });
  renderMessage("user", question);

  const botData = { role: "bot", text: "", sources: [], engine: "" };
  t.messages.push(botData);
  const botMsg = renderMessage("bot", "");
  botMsg.classList.add("typing");
  const bubble = botMsg.querySelector(".bubble");
  bubble.innerHTML = '<span class="dot">●</span><span class="dot">●</span><span class="dot">●</span>';

  busy = true; sendBtn.disabled = true; renderTabs();
  chat.scrollTop = chat.scrollHeight;

  let started = false;
  const finalize = () => {
    botMsg.classList.remove("typing");
    if (botData.text){
      bubble.innerHTML = renderMarkdown(botData.text);
      if (botData.engine){ const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = "Engine: " + botData.engine; botMsg.appendChild(meta); }
      addSources(botMsg, botData.sources);
    }
    busy = false; sendBtn.disabled = false;
    saveTabs(); renderTabs();
    chat.scrollTop = chat.scrollHeight;
  };

  try{
    const res = await fetch("/api/ask/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, engine: engineSel.value || "local", history: sentHistory })
    });
    if (res.status === 401){ location.href = "login.html"; return; }
    if (!res.ok || !res.body){
      const data = await res.json().catch(() => ({}));
      botMsg.classList.remove("typing");
      bubble.textContent = "⚠️ " + (data.error || "Fehler");
      botData.text = ""; busy = false; sendBtn.disabled = false; renderTabs(); return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true){
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop();
      for (const evt of events){
        let name = "message", dataStr = "";
        evt.split("\n").forEach(l => {
          if (l.startsWith("event:")) name = l.slice(6).trim();
          else if (l.startsWith("data:")) dataStr += l.slice(5).trim();
        });
        if (!dataStr) continue;
        let data; try { data = JSON.parse(dataStr); } catch { continue; }
        if (name === "meta"){ botData.sources = data.sources || []; botData.engine = data.engine || ""; }
        else if (name === "delta"){
          if (!started){ started = true; bubble.innerHTML = ""; botMsg.classList.remove("typing"); }
          botData.text += data.text || "";
          bubble.innerHTML = renderMarkdown(botData.text);
          chat.scrollTop = chat.scrollHeight;
        }
        else if (name === "error"){
          botMsg.classList.remove("typing");
          botData.text = ""; bubble.textContent = "⚠️ " + (data.error || "Fehler");
        }
      }
    }
    finalize();
  }catch(err){
    botMsg.classList.remove("typing");
    bubble.textContent = "⚠️ Verbindungsfehler: " + err.message;
    botData.text = ""; busy = false; sendBtn.disabled = false; renderTabs();
  }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || busy) return;
  input.value = "";
  ask(q);
});

document.addEventListener("click", e => {
  if (e.target.classList.contains("chip") && e.target.dataset.q && !busy) ask(e.target.dataset.q);
});

if (newBtn) newBtn.addEventListener("click", newTab);

// Start: erst wenn der angemeldete Nutzer bekannt ist (Key pro Nutzer setzen)
function startTabs(me){
  STORE_KEY = "rag_chat_tabs_v1::" + (me && me.username ? me.username : "anon");
  try{ localStorage.removeItem("rag_chat_tabs_v1"); }catch(e){}  // alten globalen Key aufraeumen
  loadTabs(); renderTabs(); renderChat();
}
if (window.__me && window.__me.username) startTabs(window.__me);
else document.addEventListener("me-ready", e => startTabs(e.detail), { once: true });

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
