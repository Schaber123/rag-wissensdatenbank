// Auth-Guard: auf geschuetzten Seiten einbinden. Holt /api/me, leitet bei fehlender
// Anmeldung auf login.html um und baut Nutzer-Box (Name, Admin-Link, Abmelden) in die Topbar.
(async function () {
  let me;
  try {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    if (!r.ok) { location.href = "login.html"; return; }
    me = await r.json();
  } catch (e) {
    location.href = "login.html";
    return;
  }
  window.__me = me;

  const right = document.querySelector(".topbar-right") || document.querySelector("header.topbar");
  if (right) {
    const box = document.createElement("div");
    box.className = "userbox";
    const adminLink = me.admin ? '<a class="back-link" href="admin.html" title="Verwaltung">&#9881; Admin</a>' : "";
    box.innerHTML = adminLink +
      '<span class="user-chip" title="Angemeldet als ' + (me.username || "") + '">&#128100; ' + (me.label || me.username) + "</span>" +
      '<button type="button" id="logoutbtn" class="newchat" title="Abmelden">Abmelden</button>';
    right.appendChild(box);
    document.getElementById("logoutbtn").addEventListener("click", async () => {
      try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {}
      location.href = "login.html";
    });
  }

  document.dispatchEvent(new CustomEvent("me-ready", { detail: me }));
})();
