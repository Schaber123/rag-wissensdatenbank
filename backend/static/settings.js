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
  if (isLocal) h += `<div class="row"><label>Ollama-URL</label>
    <div class="inline"><input type="text" data-engine="${id}" data-field="ollama_url" value="${en.ollama_url||""}">
      <button type="button" class="secondary" id="ollama-fetch">Modelle abrufen</button></div></div>
    <div id="ollama-models" class="model-chips"></div>`;
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
  const r = cfg.retrieval || {};
  topK.value = r.top_k || 4;
  $("r_hybrid").checked = r.hybrid !== false;
  $("r_rerank").checked = r.rerank !== false;
  $("r_candidates").value = r.candidates || 20;
  $("r_rerank_model").value = r.rerank_model || "";
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

// Ollama-Modelle vom angegebenen Server abrufen
enginesBox.addEventListener("click", async e => {
  if (e.target.id !== "ollama-fetch") return;
  const urlInput = enginesBox.querySelector('input[data-engine="local"][data-field="ollama_url"]');
  const modelInput = enginesBox.querySelector('input[data-engine="local"][data-field="model"]');
  const box = $("ollama-models");
  const url = (urlInput.value || "").trim();
  if (!url){ box.textContent = "Bitte zuerst eine Ollama-URL eingeben."; return; }
  e.target.disabled = true; box.textContent = "Lade Modelle…";
  try{
    const d = await fetch("/api/ollama/models?url=" + encodeURIComponent(url)).then(r => r.json());
    if (d.error){ box.textContent = "⚠️ " + d.error; return; }
    if (!d.models || !d.models.length){ box.textContent = "Keine Modelle auf diesem Server gefunden."; return; }
    box.innerHTML = "";
    const hint = document.createElement("span"); hint.className = "muted";
    hint.textContent = `${d.models.length} Modell(e) gefunden – zum Übernehmen anklicken: `;
    box.appendChild(hint);
    d.models.forEach(name => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip" + (modelInput.value === name ? " active" : "");
      c.textContent = name;
      c.addEventListener("click", () => {
        modelInput.value = name;
        box.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
      });
      box.appendChild(c);
    });
  }catch(err){ box.textContent = "⚠️ " + err.message; }
  finally{ e.target.disabled = false; }
});

function buildPayload(){
  const p = { default_engine: defSel.value,
    retrieval: { top_k: parseInt(topK.value)||4, hybrid: $("r_hybrid").checked,
                 rerank: $("r_rerank").checked, candidates: parseInt($("r_candidates").value)||20 },
    engines:{}, sources:{ smb:{} } };
  if ($("r_rerank_model").value.trim()) p.retrieval.rerank_model = $("r_rerank_model").value.trim();
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
  const folder = ($("upload_folder").value || "").trim();
  if (!folder && !(window.__meAdmin)){ us.textContent = "⚠️ Bitte zuerst einen Zielordner wählen."; return; }
  const fd = new FormData(); [...fileList].forEach(f => fd.append("files", f));
  if (folder) fd.append("folder", folder);
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
function ingestSummary(d){
  const parts = [];
  if (d.added)     parts.push(`${d.added} neu`);
  if (d.updated)   parts.push(`${d.updated} aktualisiert`);
  if (d.removed)   parts.push(`${d.removed} entfernt`);
  if (d.unchanged) parts.push(`${d.unchanged} unverändert`);
  if (d.skipped)   parts.push(`${d.skipped} übersprungen`);
  const summary = parts.length ? parts.join(" · ") : "keine Änderungen";
  return `✓ ${d.files} Datei(en): ${summary} · ${d.chunks} Ausschnitte neu indiziert`;
}
async function runIngest(full){
  const st = $("ingest-status"); $("smb_enabled").checked = true;
  st.textContent = "Speichere…"; $("ingest").disabled = true; $("ingest-full").disabled = true;
  try{
    await saveConfig();
    // Ingest laeuft serverseitig im Hintergrund -> Request kehrt sofort zurueck
    const res = await fetch("/api/ingest" + (full ? "?full=true" : ""), {method:"POST"});
    const d = await res.json().catch(() => ({}));
    if (!res.ok){
      st.textContent = "⚠️ " + (d.error || "Fehler");
      $("ingest").disabled = false; $("ingest-full").disabled = false; return;
    }
    st.textContent = full ? "⏳ Voll-Neuaufbau gestartet…" : "⏳ Abgleich gestartet…";
    // Fortschritt & Ergebnis zeigt ab jetzt pollStatus (Buttons bleiben bis Ende gesperrt)
  }catch(e){
    st.textContent = "⚠️ " + e.message;
    $("ingest").disabled = false; $("ingest-full").disabled = false;
  }
}
$("ingest").addEventListener("click", () => runIngest(false));
$("ingest-full").addEventListener("click", () => {
  if (confirm("Voll-Neuaufbau: Der komplette Index wird verworfen und alle Dateien neu eingelesen. Fortfahren?")) runIngest(true);
});

// --- Status-Banner + Ergebnisanzeige (Indexierung laeuft asynchron) ---
function ensureBanner(){
  let b = $("idx-banner");
  if (!b){ b = document.createElement("div"); b.id = "idx-banner"; b.className = "idx-banner"; b.style.display = "none";
           document.querySelector("main.settings").prepend(b); }
  return b;
}
let wasIndexing = false;
async function pollStatus(){
  try{
    const s = await fetch("/api/status").then(r=>r.json());
    const b = ensureBanner();
    b.textContent = "⏳ Indexierung läuft… " + (s.detail||"");
    b.style.display = s.indexing ? "block" : "none";
    const st = $("ingest-status");
    if (s.indexing){
      wasIndexing = true;
      $("ingest").disabled = true; $("ingest-full").disabled = true;
      if (st) st.textContent = "⏳ " + (s.detail || "läuft…");
    } else if (wasIndexing){
      // gerade fertig geworden
      wasIndexing = false;
      $("ingest").disabled = false; $("ingest-full").disabled = false;
      if (st){
        if (s.error) st.textContent = "⚠️ " + s.error;
        else if (s.result) st.textContent = ingestSummary(s.result);
      }
      loadDocuments();
    }
  }catch(e){}
}
setInterval(pollStatus, 3000); pollStatus();

// --- Mein Konto: Passwort ändern ---
$("pw_save").addEventListener("click", async () => {
  const st = $("pw_status");
  const oldp = $("pw_old").value, np = $("pw_new").value, np2 = $("pw_new2").value;
  if (np !== np2){ st.textContent = "⚠️ Neue Passwörter stimmen nicht überein."; return; }
  st.textContent = "Speichere…";
  try{
    const res = await fetch("/api/account/password", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({old_password: oldp, new_password: np})});
    const d = await res.json().catch(()=>({}));
    if (!res.ok){ st.textContent = "⚠️ " + (d.error||"Fehler"); return; }
    st.textContent = "✓ Passwort geändert"; $("pw_old").value=$("pw_new").value=$("pw_new2").value="";
  }catch(e){ st.textContent = "⚠️ " + e.message; }
  setTimeout(()=>st.textContent="", 4000);
});

// --- Mein Konto: 2FA ---
function render2FA(enabled){
  $("twofa_state").textContent = enabled ? "aktiv" : "nicht aktiv";
  $("twofa_on").classList.toggle("hidden", !enabled);
  $("twofa_off").classList.toggle("hidden", enabled);
  $("twofa_setup_box").classList.add("hidden");
}
$("twofa_setup").addEventListener("click", async () => {
  const msg = $("twofa_msg"); msg.textContent = "Erzeuge Schlüssel…";
  try{
    const d = await fetch("/api/2fa/setup", {method:"POST"}).then(r=>r.json());
    $("twofa_qr").src = d.qr; $("twofa_secret").textContent = d.secret;
    $("twofa_setup_box").classList.remove("hidden"); msg.textContent = "";
  }catch(e){ msg.textContent = "⚠️ " + e.message; }
});
$("twofa_enable").addEventListener("click", async () => {
  const msg = $("twofa_msg");
  try{
    const res = await fetch("/api/2fa/enable", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({code: $("twofa_code").value.trim()})});
    const d = await res.json().catch(()=>({}));
    if (!res.ok){ msg.textContent = "⚠️ " + (d.error||"Fehler"); return; }
    msg.textContent = "✓ aktiviert"; render2FA(true);
  }catch(e){ msg.textContent = "⚠️ " + e.message; }
});
$("twofa_disable").addEventListener("click", async () => {
  const msg = $("twofa_msg2");
  try{
    const res = await fetch("/api/2fa/disable", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({password: $("twofa_pw").value})});
    const d = await res.json().catch(()=>({}));
    if (!res.ok){ msg.textContent = "⚠️ " + (d.error||"Fehler"); return; }
    msg.textContent = "✓ deaktiviert"; $("twofa_pw").value=""; render2FA(false);
  }catch(e){ msg.textContent = "⚠️ " + e.message; }
});

async function populateFolders(me){
  const dl = $("folder-options"); if (!dl) return;
  let folders = [];
  try{
    if (me.admin){ const d = await fetch("/api/admin/folders").then(r=>r.json()); folders = d.folders||[]; }
    else folders = me.folders||[];
  }catch(e){ folders = me.folders||[]; }
  dl.innerHTML = ""; folders.forEach(f => { const o=document.createElement("option"); o.value=f; dl.appendChild(o); });
}

// --- Branding / Logo ---
let logoH = 34;
function applyLogoPreview(){
  $("logo_h_val").textContent = logoH;
  $("logo_height").value = logoH;
  $("logo_prev").style.height = logoH + "px";
}
async function loadBranding(){
  try{
    const b = await fetch("/api/branding").then(r=>r.json());
    logoH = b.logo_height || 34;
    $("logo_prev").src = (b.logo || "logo.png") + "?v=" + Date.now();
    applyLogoPreview();
  }catch(e){}
}
if ($("logo_height")) $("logo_height").addEventListener("input", () => {
  logoH = parseInt($("logo_height").value) || 34; applyLogoPreview();
});
if ($("logo_file")) $("logo_file").addEventListener("change", () => {
  const f = $("logo_file").files[0];
  if (f){ const url = URL.createObjectURL(f); $("logo_prev").src = url; }
});
if ($("branding_save")) $("branding_save").addEventListener("click", async () => {
  const st = $("branding_status"); st.textContent = "Speichere…";
  try{
    const f = $("logo_file").files[0];
    if (f){
      const fd = new FormData(); fd.append("file", f);
      const res = await fetch("/api/branding/logo", {method:"POST", body: fd});
      const d = await res.json().catch(()=>({}));
      if (!res.ok){ st.textContent = "⚠️ " + (d.error||"Fehler beim Logo-Upload"); return; }
      $("logo_file").value = "";
    }
    await fetch("/api/config", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({branding:{logo_height: logoH}})});
    st.textContent = "✓ gespeichert";
    // Topbar-Logo + Vorschau sofort aktualisieren
    const b = await fetch("/api/branding").then(r=>r.json());
    const src = (b.logo||"logo.png") + "?v=" + Date.now();
    document.querySelectorAll("img.logo").forEach(img => { img.src = src; img.style.height = (b.logo_height||34)+"px"; });
  }catch(e){ st.textContent = "⚠️ " + e.message; }
  setTimeout(()=>st.textContent="", 4000);
});

// --- Init: Rechte des angemeldeten Nutzers anwenden ---
async function init(){
  let me;
  try{ const r = await fetch("/api/me"); if (!r.ok){ location.href="login.html"; return; } me = await r.json(); }
  catch(e){ location.href="login.html"; return; }
  window.__meAdmin = !!me.admin;
  render2FA(!!me.totp_enabled);
  populateFolders(me);
  loadDocuments();
  if (me.admin){
    loadConfig();
    loadBranding();
  } else {
    // Admin-Bereiche ausblenden, Standard-Tab auf "Datenquelle & Dokumente"
    document.querySelectorAll(".tab[data-admin]").forEach(t => t.style.display = "none");
    const sc = $("source-card"); if (sc) sc.style.display = "none";
    const ca = $("config-actions"); if (ca) ca.style.display = "none";
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.add("hidden"));
    const dt = document.querySelector('.tab[data-tab="docs"]'); if (dt) dt.classList.add("active");
    $("tab-docs").classList.remove("hidden");
  }
}
init();
