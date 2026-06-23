# RAG Wissensdatenbank

**KI-Wissensdatenbank für interne Dokumente — mit Quellenangaben, Benutzerrechten und optional lokalem Betrieb.**

🌐 **Produktseite:** [techit-consulting.de/rag-wissensdatenbank.html](https://www.techit-consulting.de/rag-wissensdatenbank.html)

---

## Was ist das?

Die **RAG Wissensdatenbank** ist eine webbasierte KI-Anwendung für KMU, die interne Dokumente per Chat durchsuchbar macht.

Du stellst eine Frage in normaler Sprache. Die Anwendung sucht passende Stellen in den hinterlegten Dateien, erstellt daraus eine Antwort und zeigt die verwendeten Quellen an.

Geeignet für Unternehmen, die Wissen aus PDFs, Office-Dateien, Scans, Anleitungen, Protokollen oder Dateiserver-Strukturen nutzbar machen möchten, ohne alles in ein öffentliches KI-Tool zu kopieren.

---

## Features

- ✅ **Chat mit internen Dokumenten** statt manueller Ordnersuche
- ✅ **Quellenangaben** zu Antworten, inklusive PDF-Seitenbezug
- ✅ **Viele Dateitypen:** PDF, Word, Excel, PowerPoint, CSV, HTML, Text und Bilder
- ✅ **OCR für Scans und Bilddateien**
- ✅ **Benutzer und Gruppenrechte** für ordnerbasierte Freigaben
- ✅ **Mehrere KI-Engines:** lokale Modelle oder Cloud-Modelle je nach Betriebsmodell
- ✅ **Inkrementelle Indexierung** neuer oder geänderter Dateien
- ✅ **Docker-basierter Betrieb** mit FastAPI und Qdrant

---

## Typische Einsatzbereiche

- interne Wissensdatenbank für Handbücher, Anleitungen und Prozessdokumente
- Suche in Projektordnern, Angeboten, Protokollen und Vorlagen
- Unterstützung für Onboarding, Support, Verwaltung und Technik
- kontrollierte KI-Nutzung mit nachvollziehbaren Quellen
- Pilotprojekte für KI im KMU-Umfeld

---

## So funktioniert es

```text
1. Dokumente anbinden      →   z. B. Dateiserver, SMB-Freigabe oder Upload
2. Index aufbauen          →   Texte werden extrahiert, OCR läuft bei Bedarf
3. Frage stellen           →   Die KI sucht passende Quellen und antwortet daraus
4. Quelle prüfen           →   Dokumente und PDF-Seiten können direkt geöffnet werden
```

---

## Technologie

- **Backend:** FastAPI / Python
- **Vektordatenbank:** Qdrant
- **Retrieval:** Dense Search, optionale Hybrid-Suche und Reranking
- **Frontend:** statische Weboberfläche
- **Deployment:** Docker Compose
- **OCR:** Tesseract
- **LLM-Anbindung:** lokal oder über externe Anbieter, abhängig von der Konfiguration

---

## Lizenz & Angebot

Die RAG Wissensdatenbank ist als betreute Lösung von **Tech-IT Consulting** erhältlich.

Typisches Modell:

- einmalige Einrichtung
- Jahreslizenz oder Lifetime-Lizenz
- optionaler Support, Updates, Hosting oder lokale Betriebsunterstützung

👉 Details auf der Produktseite:  
[techit-consulting.de/rag-wissensdatenbank.html](https://www.techit-consulting.de/rag-wissensdatenbank.html)

---

## Sicherheit

Dieses Repository enthält keine produktiven Zugangsdaten.

Nicht ins Repository gehören:

- `.env`
- API-Keys
- Lizenz-Secrets
- SMB-/Dateiserver-Zugangsdaten
- Benutzerdateien
- Chatverläufe
- Kundendaten

Die entsprechenden Dateien sind über `.gitignore` ausgeschlossen.

---

## Hersteller

**Tech-IT Consulting — Markus Gehring**  
🌐 [techit-consulting.de](https://www.techit-consulting.de)  
📧 info@techit-consulting.de

---

*Dieses Repository dient der öffentlichen Projektbeschreibung und technischen Basis der RAG Wissensdatenbank. Produktive Konfigurationen, Kundendaten und Secrets sind nicht enthalten.*
