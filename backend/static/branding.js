// Wendet das konfigurierte Logo (Datei + Höhe) auf alle Seiten an. Auf jeder Seite einbinden.
(function () {
  fetch("/api/branding").then(r => r.json()).then(b => {
    const src = (b.logo || "logo.png") + "?v=" + Date.now();   // ?v gegen Browser-Cache
    const h = b.logo_height || 34;
    document.querySelectorAll("img.logo").forEach(img => { img.src = src; img.style.height = h + "px"; });
    document.documentElement.style.setProperty("--logo-h", h + "px");
  }).catch(() => {});
})();
