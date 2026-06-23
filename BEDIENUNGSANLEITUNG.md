# Bedienungsanleitung – RAG Wissensdatenbank

**V1.0 · Stand: 2026-06-23**

Die RAG Wissensdatenbank beantwortet Fragen **ausschließlich** auf Basis deiner
hinterlegten Dokumente (Retrieval-Augmented Generation). Diese Anleitung beschreibt
die Bedienung für Anwender und Administratoren.

> Zur Installation siehe [INSTALL.md](INSTALL.md). Änderungen je Version: [CHANGELOG.md](CHANGELOG.md).

---

## 1. Anmelden

1. Web-Adresse der Wissensdatenbank öffnen (z. B. `https://rag.lan`).
2. Mit Benutzername und Passwort anmelden. Ist 2FA aktiv, zusätzlich den 6-stelligen Code aus der Authenticator-App eingeben.

Die aktuelle **Version** steht unten im Footer (z. B. `V1.0`).

---

## 2. Fragen stellen (Chat)

1. Frage ins Eingabefeld tippen und **Senden** (oder Enter).
2. Die Antwort wird live erzeugt (Streaming) und stützt sich nur auf gefundene Dokument-Ausschnitte.
3. Unter der Antwort erscheinen die **Quellen** – anklickbar, öffnet die Originaldatei (bei PDF seitengenau).

**Engine wählen:** Oben rechts unter „Engine" das Sprachmodell wählen
(z. B. *Lokal · Mac* für lokale Verarbeitung oder eine Cloud-Engine). Steht nichts zur Auswahl,
ist die Engine in den Einstellungen noch nicht aktiviert/hinterlegt.

**Mehrere Unterhaltungen:** Über **+ Neuer Chat** öffnest du einen weiteren Chat-Tab.
Tabs lassen sich wechseln und schließen.

---

## 3. Spracheingabe (Mikrofon)

- Auf das **🎤-Symbol** neben dem Senden-Knopf klicken, sprechen, erneut klicken zum Beenden.
- Bei lokaler Engine wird das Audio auf dem Server (Whisper) transkribiert – nichts verlässt das Haus.
  Bei einer Cloud-Engine nutzt der Browser seine eigene Spracherkennung.
- **Voraussetzung:** Die Seite muss über **HTTPS** laufen (z. B. `https://rag.lan`), sonst gibt der
  Browser das Mikrofon nicht frei.

---

## 4. Darstellung (Light/Dark)

Oben rechts neben dem Zahnrad schaltet das **☀/☾-Symbol** zwischen hellem und dunklem Design um.
Die Wahl wird pro Browser gespeichert.

---

## 5. Einstellungen (Zahnrad)

### 5.1 LLM-Zugänge *(Admin)*
- **Standard-Engine** festlegen (wird genutzt, wenn im Chat nichts anderes gewählt ist).
- Je Engine aktivieren und – bei Cloud-Engines – den API-Schlüssel hinterlegen.
  Für die lokale Engine die erreichbare Ollama-URL eintragen; über „Ollama-Modelle abrufen"
  lässt sich ein Modell auswählen.

### 5.2 Datenquelle & Dokumente
- **SMB-Freigabe (Netzwerklaufwerk):** Host, Freigabe, Unterordner, Benutzer/Passwort. Funktioniert mit jeder SMB-Freigabe (Windows-Dateiserver, NAS, Samba). Dateien bleiben auf der Freigabe, indiziert werden nur Text-Ausschnitte.
- **Abgleichen (nur Änderungen):** liest neue/geänderte Dateien ein, entfernt gelöschte – schnell.
- **Voll-Neuaufbau:** verwirft den Index und liest alles neu (nach größeren Umstellungen).
- **Hochladen:** Dateien per Drag & Drop in die Dropzone; sie werden auf die SMB-Freigabe geschrieben und sofort indiziert.
  Unterstützt PDF, Word, Excel, PowerPoint, CSV, HTML, Text und Bilder (mit OCR).

### 5.3 Allgemein *(Admin)*
- **Trefferanzahl (top_k):** wie viele Text-Ausschnitte je Frage als Kontext dienen (Standard 4; viele/lange Dokumente → 6–8).
- **Suche & Relevanz:** Hybrid-Suche und Reranking ein/aus, Kandidatenzahl, Reranker-Modell.
- **Lizenz:** Lizenzschlüssel eintragen → Status („✓ Lizenziert · Gültig bis …"). Siehe Abschnitt 7.
- **Logo:** Logo austauschen und Größe anpassen (wirkt auf alle Seiten).

### 5.4 Mein Konto
- **Passwort ändern.**
- **2FA (TOTP)** einrichten/deaktivieren: QR-Code mit der Authenticator-App scannen, Code bestätigen.

---

## 6. Verwaltung *(Admin)*

Erreichbar über **Einstellungen → Verwaltung** bzw. `admin.html`.

- **Nutzer:** anlegen (Benutzername, Anzeigename, Passwort, Admin-Flag), Gruppen zuweisen,
  Passwort zurücksetzen, 2FA zurücksetzen, löschen.
- **Gruppen:** definieren, welche **Ordner** eine Gruppe sehen darf (Ordner-ACL). Nutzer sehen nur
  Dokumente aus ihren freigegebenen Ordnern; Administratoren sehen alles.

> Nach Änderungen an Ordnerfreigaben kann ein **Voll-Neuaufbau** nötig sein, damit Altdaten die
> Berechtigungs-Präfixe erhalten.

---

## 7. Lizenz eintragen

1. Im Lizenz Admin einen Schlüssel für das Produkt **RAGW** ausstellen.
2. In der Wissensdatenbank: **Einstellungen → Allgemein → Lizenz**, Schlüssel einfügen, **Lizenz speichern**.
3. Status sollte auf **„✓ Lizenziert"** wechseln (mit Ablaufdatum bzw. „Dauerlizenz").

**Ablauf ohne gültige Lizenz:** 30 Tage Testzeitraum, danach 10 Tage Kulanz, anschließend ist der
Chat gesperrt, bis ein gültiger Schlüssel hinterlegt ist. Ein Banner im Chat weist auf den Status hin.

---

## 8. Häufige Probleme

| Symptom | Ursache / Lösung |
|---|---|
| Mikrofon reagiert nicht | Seite läuft nicht über HTTPS → über `https://rag.lan` (Reverse-Proxy) öffnen. |
| „Engine nicht verfügbar" | Engine in den Einstellungen aktivieren bzw. API-Schlüssel hinterlegen. |
| Lokale Engine antwortet nicht | Ollama nicht erreichbar (bei Netbird-Anbindung ggf. `netbird up` auf dem Mac). |
| „Ungültiger Schlüssel (Signatur)" | Lizenz-Secret im Server (`RAG_LICENSE_SECRET`) passt nicht zum Produkt-Secret im Lizenz Admin. |
| Antwort findet bekannte Info nicht | Trefferanzahl (top_k) erhöhen oder Voll-Neuaufbau des Index. |
| Chat gesperrt | Lizenz abgelaufen/fehlt → gültigen Schlüssel eintragen (Abschnitt 7). |
