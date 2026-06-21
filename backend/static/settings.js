const $ = id => document.getElementById(id);
$("year").textContent = new Date().getFullYear();
const enginesBox = $("engines"), defSel = $("default_engine"), topK = $("top_k"), statusEl = $("status");
const CLOUD = ["claude", "openai", "gemini"];
let cfg = null;

// --- Tabs ---
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  document.querySelectorAll(".tabpane").forEach(p => p.classList.add("hidden"));
  $("tab-" + t.dataset.tab).classList.remove("hidden");
}));

function engineCard(id, en){
  const isLocal = id === "local";
  const w = document.createElement("section"); w.className = "card";
  let h = `<div class="card-head"><h2>${en.label}</h2>
    <label class="switch"><input type="checkbox" data-engine="${id}" data-field="enabled" ${en.enabled?"checked":""}><span>aktiv</span></label></div>
    <div class="row"><label>Modell</label><input type="text" data-engine="${id}" data-field="model" value="${en.model||""}"></div>`;
  if (isLocal) h += `<div class="row"><label>Ollama-URL</label><input type="text" data-engine="${id}" data-field="ollama_url" value="${en.ollama_url||""}"></div>`;
  else {
    const ph = en.key_from_env ? "aus Umgebungsvariable" : (en.has_key ? "hinterlegt – leer lassen zum Behalten" : "API-Key eingeben");
    h += `<div class="row"><label>API-Key ${en.has_key?'<span class="ok">&#10003; vorhanden</span>':'<span class="warn">fehlt</span>'}</label>
      <input type="password" data-engine="${id}" data-field="api_key" placeholder="${ph}" autocomplete="new-password"></div>`;
  }
  w.innerHTML = h; return w;
}

function render(){
  enginesBox.innerHTML = "";
  ["local", ...CLOUD].forEach(id => enginesBox.appendChild(engineCard(id, cfg.engines[id])));
  defSel.innerHTML = "";
  ["local", ...CLOUD].forEach(id => {
    const o = document.createElement("option"); o.value = id; o.textContent = cfg.engines[id].label;
    if (cfg.default_engine === id) o.selected = true; defSel.appendChild(o);
  });
  topK.value = (cfg.retrieval && cfg.retrieval.top_k) || 4;
  const s = cfg.sources.smb;
  $("smb_enabled").checked = !!s.enabled; $("smb_host").value = s.host||""; $("smb_share").value = s.share||"";
  $("smb_path").value = s.path||""; $("smb_user").value = s.username||"";
  $("smb_pwstate").innerHTML = s.has_password ? '<span class="ok">&#10003; hinterlegt</span>' : '<span class="warn">fehlt</span>';
  $("smb_pw").placeholder = s.has_password ? "hinterlegt – leer lassen zum Behalten" : "Passwort";
}

enginesBox.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset && el.dataset.field === "api_key" && el.value){
    const cb = enginesBox.querySelector(`input[type=checkbox][data-engine="${el.dataset.engine}"][data-field="enabled"]`);
    if (cb) cb.checked = true;
  }
});

function buildPayload(){
  const p = { default_engine: defSel.value, retrieval: { top_k: parseInt(topK.value)||4 }, engines:{}, sources:{ smb:{} } };
  document.querySelectorAll("[data-engine]").forEach(el => {
    const e = el.dataset.engine, f = el.dataset.field; p.engines[e] = p.engines[e]||{};
    if (el.type === "checkbox") p.engines[e][f] = el.checked; else if (el.value !== "") p.engines[e][f] = el.value;
  });
  const smb = p.sources.smb;
  smb.enabled = $("smb_enabled").checked; smb.host = $("smb_host").value; smb.share = $("smb_share").value;
  smb.path = $("smb_path").value; smb.username = $("smb_user").value;
  if ($("smb_pw").value !== "") smb.password = $("smb_pw").value;
  return p;
}
async function saveConfig(){
  const res = await fetch("/api/config", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(buildPayload())});
  if (!res.ok) throw new Error("Speichern fehlgeschlagen");
  cfg = await fetch("/api/config").then(r=>r.json()); render();
}
async function loadConfig(){ cfg = await fetch("/api/config").then(r=>r.json()); render(); }

async function loadDocuments(){
  try{
    const d = await fetch("/api/documents").then(r=>r.json());
    $("doc-count").textContent = `(${d.documents.length} Datei(en), ${d.total_chunks} Ausschnitte)`;
    const box = $("doclist"); box.innerHTML = "";
    if (!d.documents.length){ box.innerHTML = '<p class="note">Noch keine Dokumente indiziert.</p>'; return; }
    d.documents.forEach(doc => {
      const r = document.createElement("div"); r.className = "docrow";
      r.innerHTML = `<span class="docname">&#128196; ${doc.source}</span><span class="muted">${doc.chunks} Ausschnitte</span>`;
      box.appendChild(r);
    });
  }catch(e){}
}

// --- Upload (Drag & Drop) ---
const dz = $("dropzone"), fi = $("fileinput");
dz.addEventListener("click", () => fi.click());
fi.addEventListener("change", () => { if (fi.files.length) uploadFiles(fi.files); fi.value = ""; });
["dragover","dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

async function uploadFiles(fileList){
  const us = $("upload-status");
  const fd = new FormData(); [...fileList].forEach(f => fd.append("files", f));
  us.textContent = `Lade ${fileList.length} Datei(en) hoch & indiziere…`;
  try{
    const res = await fetch("/api/upload", {method:"POST", body: fd});
    const d = await res.json();
    if (!res.ok){ us.textContent = "⚠️ " + (d.error||"Fehler"); return; }
    const bad = d.results.filter(r=>r.error);
    us.textContent = `✓ ${d.results.length-bad.length} indiziert` + (bad.length ? ` · ⚠️ ${bad.map(b=>b.file+": "+b.error).join("; ")}` : "");
    loadDocuments();
  }catch(e){ us.textContent = "⚠️ " + e.message; }
}

$("save").addEventListener("click", async () => {
  statusEl.textContent = "Speichere…";
  try{ await saveConfig(); statusEl.textContent = "✓ Gespeichert"; } catch(e){ statusEl.textContent = "⚠️ " + e.message; }
  setTimeout(() => statusEl.textContent = "", 3000);
});
async function runIngest(full){
  const st = $("ingest-status"); $("smb_enabled").checked = true;
  st.textContent = full ? "Speichere & lese komplett neu ein… (kann dauern)" : "Speichere & gleiche ab…";
  $("ingest").disabled = true; $("ingest-full").disabled = true;
  try{
    await saveConfig();
    const res = await fetch("/api/ingest" + (full ? "?full=true" : ""), {method:"POST"});
    const d = await res.json();
    if (!res.ok){ st.textContent = "⚠️ " + (d.error||"Fehler"); return; }
    const parts = [];
    if (d.added)     parts.push(`${d.added} neu`);
    if (d.updated)   parts.push(`${d.updated} aktualisiert`);
    if (d.removed)   parts.push(`${d.removed} entfernt`);
    if (d.unchanged) parts.push(`${d.unchanged} unverändert`);
    if (d.skipped)   parts.push(`${d.skipped} übersprungen`);
    const summary = parts.length ? parts.join(" · ") : "keine Änderungen";
    st.textContent = `✓ ${d.files} Datei(en): ${summary} · ${d.chunks} Ausschnitte neu indiziert`;
    loadDocuments();
  }catch(e){ st.textContent = "⚠️ " + e.message; }
  finally { $("ingest").disabled = false; $("ingest-full").disabled = false; }
}
$("ingest").addEventListener("click", () => runIngest(false));
$("ingest-full").addEventListener("click", () => {
  if (confirm("Voll-Neuaufbau: Der komplette Index wird verworfen und alle Dateien neu eingelesen. Fortfahren?")) runIngest(true);
});

// --- Status-Banner (Indexierung laeuft) ---
function ensureBanner(){
  let b = $("idx-banner");
  if (!b){ b = document.createElement("div"); b.id = "idx-banner"; b.className = "idx-banner"; b.style.display = "none";
           document.querySelector("main.settings").prepend(b); }
  return b;
}
async function pollStatus(){
  try{
    const s = await fetch("/api/status").then(r=>r.json());
    const b = ensureBanner();
    b.textContent = "⏳ Indexierung läuft… " + (s.detail||"");
    b.style.display = s.indexing ? "block" : "none";
  }catch(e){}
}
setInterval(pollStatus, 3000); pollStatus();

loadConfig(); loadDocuments();
