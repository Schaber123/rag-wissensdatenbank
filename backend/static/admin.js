const $ = id => document.getElementById(id);
$("year").textContent = new Date().getFullYear();

let GROUPS = [];   // [{id,label,folders}]
let FOLDERS = [];  // ["Technik", "Technik/Maschinen", ...]
let MANUAL = [];   // manuell ergaenzte Ordner fuer das Anlege-Formular

// --- Tabs ---
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  document.querySelectorAll(".tabpane").forEach(p => p.classList.add("hidden"));
  $("tab-" + t.dataset.tab).classList.remove("hidden");
}));

async function api(method, url, body){
  const opt = { method, headers: {}, credentials: "same-origin" };
  if (body){ opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (r.status === 401){ location.href = "login.html"; throw new Error("unauth"); }
  if (r.status === 403){ location.href = "index.html"; throw new Error("forbidden"); }
  let d = {}; try { d = await r.json(); } catch(e){}
  if (!r.ok) throw new Error(d.error || "Fehler");
  return d;
}

function checkboxGrid(container, items, getLabel, getVal, checkedSet){
  container.innerHTML = "";
  if (!items.length){ container.innerHTML = '<span class="muted">– keine –</span>'; return; }
  items.forEach(it => {
    const val = getVal(it);
    const lab = document.createElement("label"); lab.className = "switch";
    lab.innerHTML = `<input type="checkbox" value="${val}" ${checkedSet && checkedSet.has(val) ? "checked":""}><span>${getLabel(it)}</span>`;
    container.appendChild(lab);
  });
}
function checkedValues(container){
  return [...container.querySelectorAll("input[type=checkbox]:checked")].map(c => c.value);
}

// ---------------- Nutzer ----------------
function renderNewUserGroups(){
  checkboxGrid($("nu_groups"), GROUPS, g => g.label, g => g.id, null);
}
async function loadUsers(){
  const d = await api("GET", "/api/admin/users");
  $("users-count").textContent = `(${d.users.length})`;
  const box = $("userlist"); box.innerHTML = "";
  d.users.forEach(u => box.appendChild(userRow(u)));
}
function userRow(u){
  const wrap = document.createElement("div"); wrap.className = "card admin-row";
  const checked = new Set(u.groups || []);
  wrap.innerHTML = `
    <div class="card-head">
      <h2>${u.label || u.username} <span class="muted">@${u.username}</span></h2>
      <span class="muted">${u.admin ? "Administrator · " : ""}${u.totp_enabled ? "2FA aktiv" : "2FA aus"}</span>
    </div>
    <div class="grid2">
      <div class="row"><label>Anzeigename</label><input class="u_label" type="text" value="${u.label||""}"></div>
      <div class="row admincheck-row"><label class="switch"><input class="u_admin" type="checkbox" ${u.admin?"checked":""}><span>Administrator</span></label></div>
    </div>
    <div class="row"><label>Gruppen</label><div class="u_groups checkbox-grid"></div></div>
    <div class="source-actions">
      <button type="button" class="secondary u_save">Speichern</button>
      <button type="button" class="secondary u_pw">Passwort zurücksetzen</button>
      <button type="button" class="secondary u_2fa">2FA zurücksetzen</button>
      <button type="button" class="secondary u_del">Löschen</button>
      <span class="status u_status"></span>
    </div>`;
  checkboxGrid(wrap.querySelector(".u_groups"), GROUPS, g => g.label, g => g.id, checked);
  const st = wrap.querySelector(".u_status");
  wrap.querySelector(".u_save").addEventListener("click", async () => {
    st.textContent = "Speichere…";
    try{
      await api("PUT", "/api/admin/users/" + encodeURIComponent(u.username), {
        label: wrap.querySelector(".u_label").value,
        admin: wrap.querySelector(".u_admin").checked,
        groups: checkedValues(wrap.querySelector(".u_groups")),
      });
      st.textContent = "✓ gespeichert"; loadUsers();
    }catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  wrap.querySelector(".u_pw").addEventListener("click", async () => {
    const np = prompt(`Neues Passwort für ${u.username} (mind. 8 Zeichen):`);
    if (!np) return;
    try{ await api("PUT", "/api/admin/users/" + encodeURIComponent(u.username), {password: np}); st.textContent = "✓ Passwort gesetzt"; }
    catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  wrap.querySelector(".u_2fa").addEventListener("click", async () => {
    if (!confirm(`2FA für ${u.username} zurücksetzen?`)) return;
    try{ await api("PUT", "/api/admin/users/" + encodeURIComponent(u.username), {reset_2fa: true}); st.textContent = "✓ 2FA zurückgesetzt"; loadUsers(); }
    catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  wrap.querySelector(".u_del").addEventListener("click", async () => {
    if (!confirm(`Nutzer ${u.username} wirklich löschen?`)) return;
    try{ await api("DELETE", "/api/admin/users/" + encodeURIComponent(u.username)); loadUsers(); }
    catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  return wrap;
}
$("nu_create").addEventListener("click", async () => {
  const st = $("nu_status"); st.textContent = "Lege an…";
  try{
    await api("POST", "/api/admin/users", {
      username: $("nu_name").value, label: $("nu_label").value, password: $("nu_pw").value,
      admin: $("nu_admin").checked, groups: checkedValues($("nu_groups")),
    });
    $("nu_name").value = $("nu_label").value = $("nu_pw").value = ""; $("nu_admin").checked = false;
    st.textContent = "✓ angelegt"; loadUsers(); renderNewUserGroups();
  }catch(e){ st.textContent = "⚠️ " + e.message; }
});

// ---------------- Gruppen ----------------
function folderItems(){ return [...new Set([...FOLDERS, ...MANUAL])].sort(); }
function renderNewGroupFolders(checked){
  checkboxGrid($("ng_folders"), folderItems(), f => f, f => f, checked || new Set());
}
$("ng_folder_manual").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = e.target.value.trim().replace(/^\/+|\/+$/g, "");
  if (v && !folderItems().includes(v)){ MANUAL.push(v); const cur = new Set(checkedValues($("ng_folders"))); cur.add(v); renderNewGroupFolders(cur); }
  e.target.value = "";
});
async function loadGroups(){
  const d = await api("GET", "/api/admin/groups");
  GROUPS = d.groups || [];
  $("groups-count").textContent = `(${GROUPS.length})`;
  const box = $("grouplist"); box.innerHTML = "";
  GROUPS.forEach(g => box.appendChild(groupRow(g)));
  renderNewUserGroups();
}
function groupRow(g){
  const wrap = document.createElement("div"); wrap.className = "card admin-row";
  const checked = new Set(g.folders || []);
  wrap.innerHTML = `
    <div class="card-head"><h2>${g.label} <span class="muted">#${g.id}</span></h2></div>
    <div class="row"><label>Anzeigename</label><input class="g_label" type="text" value="${g.label||""}"></div>
    <div class="row"><label>Erlaubte Ordner</label><div class="g_folders checkbox-grid"></div></div>
    <div class="row"><label>Weiterer Ordner (Enter)</label><input class="g_manual" type="text" placeholder="z.B. Technik/Maschinen"></div>
    <div class="source-actions">
      <button type="button" class="secondary g_save">Speichern</button>
      <button type="button" class="secondary g_del">Löschen</button>
      <span class="status g_status"></span>
    </div>`;
  // Ordner aus dem Index + bereits zugewiesene (auch wenn sie aktuell nicht im Index sind)
  const items = [...new Set([...folderItems(), ...(g.folders||[])])].sort();
  checkboxGrid(wrap.querySelector(".g_folders"), items, f => f, f => f, checked);
  const st = wrap.querySelector(".g_status");
  wrap.querySelector(".g_manual").addEventListener("keydown", e => {
    if (e.key !== "Enter") return; e.preventDefault();
    const v = e.target.value.trim().replace(/^\/+|\/+$/g, "");
    if (v){ const cur = new Set(checkedValues(wrap.querySelector(".g_folders"))); cur.add(v);
            const it = [...new Set([...items, v])].sort();
            checkboxGrid(wrap.querySelector(".g_folders"), it, f => f, f => f, cur); }
    e.target.value = "";
  });
  wrap.querySelector(".g_save").addEventListener("click", async () => {
    st.textContent = "Speichere…";
    try{
      await api("PUT", "/api/admin/groups/" + encodeURIComponent(g.id), {
        label: wrap.querySelector(".g_label").value,
        folders: checkedValues(wrap.querySelector(".g_folders")),
      });
      st.textContent = "✓ gespeichert"; loadGroups();
    }catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  wrap.querySelector(".g_del").addEventListener("click", async () => {
    if (!confirm(`Gruppe ${g.label} löschen? Sie wird bei allen Nutzern entfernt.`)) return;
    try{ await api("DELETE", "/api/admin/groups/" + encodeURIComponent(g.id)); loadGroups(); loadUsers(); }
    catch(e){ st.textContent = "⚠️ " + e.message; }
  });
  return wrap;
}
$("ng_create").addEventListener("click", async () => {
  const st = $("ng_status"); st.textContent = "Lege an…";
  try{
    await api("POST", "/api/admin/groups", {
      label: $("ng_label").value, folders: checkedValues($("ng_folders")),
    });
    $("ng_label").value = ""; MANUAL = []; st.textContent = "✓ angelegt";
    loadGroups();
  }catch(e){ st.textContent = "⚠️ " + e.message; }
});

// ---------------- Init ----------------
async function init(){
  let me;
  try{ const r = await fetch("/api/me"); if (!r.ok){ location.href = "login.html"; return; } me = await r.json(); }
  catch(e){ location.href = "login.html"; return; }
  if (!me.admin){ location.href = "index.html"; return; }
  try{ const d = await api("GET", "/api/admin/folders"); FOLDERS = d.folders || []; }catch(e){}
  renderNewGroupFolders();
  await loadGroups();
  await loadUsers();
}
init();
