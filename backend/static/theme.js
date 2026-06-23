// Light-/Dark-Mode. Im <head> einbinden, damit das Theme vor dem ersten
// Rendern gesetzt wird (kein Aufblitzen). Injiziert einen Umschalter in die Topbar.
(function () {
  var KEY = "rag-theme";
  function get() { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; }
  function apply(t) { document.documentElement.setAttribute("data-theme", t); }

  // Sofort anwenden (synchron im <head>) -> verhindert Flash beim Laden.
  apply(get());

  var btn = null;
  function refresh() {
    if (!btn) return;
    var light = get() === "light";
    btn.textContent = light ? "☾" : "☀";          // Mond (-> Dark) / Sonne (-> Light)
    btn.title = light ? "Dark-Mode aktivieren" : "Light-Mode aktivieren";
  }
  function toggle() { var t = get() === "light" ? "dark" : "light"; localStorage.setItem(KEY, t); apply(t); refresh(); }

  document.addEventListener("DOMContentLoaded", function () {
    var right = document.querySelector(".topbar-right");
    if (!right) return;                                       // z. B. Login-Seite ohne Topbar
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.setAttribute("aria-label", "Theme wechseln");
    btn.addEventListener("click", toggle);
    var gear = right.querySelector(".gear");           // direkt neben das Zahnrad
    if (gear) right.insertBefore(btn, gear);
    else right.insertBefore(btn, right.firstChild);    // Seiten ohne Zahnrad: ganz links
    refresh();
  });
})();
