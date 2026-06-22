document.getElementById("year").textContent = new Date().getFullYear();

const form   = document.getElementById("loginform");
const stepPw = document.getElementById("step-pw");
const step2  = document.getElementById("step-2fa");
const errBox = document.getElementById("loginerr");
const btn    = document.getElementById("loginbtn");
let pending  = null;  // Token zwischen Passwort- und 2FA-Schritt

function showErr(msg) { errBox.textContent = msg || ""; }

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "same-origin", body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr("");
  btn.disabled = true;
  try {
    if (pending) {
      // Schritt 2: 2FA-Code
      const code = document.getElementById("code").value.trim();
      const { ok, data } = await postJSON("/api/login/2fa", { pending, code });
      if (!ok) { showErr(data.error || "Code ungültig."); return; }
      location.href = "index.html";
    } else {
      // Schritt 1: Benutzername + Passwort
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const { ok, data } = await postJSON("/api/login", { username, password });
      if (!ok) { showErr(data.error || "Anmeldung fehlgeschlagen."); return; }
      if (data.need_2fa) {
        pending = data.pending;
        stepPw.classList.add("hidden");
        step2.classList.remove("hidden");
        btn.textContent = "Code bestätigen";
        document.getElementById("code").focus();
        return;
      }
      location.href = "index.html";
    }
  } catch (err) {
    showErr("Verbindungsfehler.");
  } finally {
    btn.disabled = false;
  }
});
