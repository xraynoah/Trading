# Trading Journal

Mobile-first SMC Trading Journal mit Profit-Kalender, anpassbaren Checklisten und Screenshot-Upload.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 18 oder höher.

```bash
npm install
npm run dev
```

Öffnet `http://localhost:5173`. Im gleichen Netzwerk auf dem Handy aufrufbar über die IP, die im Terminal angezeigt wird (`npm run dev -- --host`).

## Auf GitHub hochladen

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<DEIN-USERNAME>/<REPO-NAME>.git
git push -u origin main
```

## Deployment

### Option A: Vercel (empfohlen, einfachste)

1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden
2. "Add New Project" → dein Repo auswählen
3. Framework wird automatisch als "Vite" erkannt → "Deploy"
4. Fertig. URL sieht so aus: `trading-journal-xxx.vercel.app`

Jeder `git push` deployt automatisch neu.

### Option B: GitHub Pages (auch gratis)

1. Repo auf GitHub öffnen → **Settings** → **Pages**
2. Unter "Build and deployment" → **Source** auf "**GitHub Actions**" stellen
3. Nach dem nächsten Push läuft der Workflow automatisch (siehe Actions-Tab)
4. URL: `https://<dein-username>.github.io/<repo-name>/`

Der Workflow ist schon in `.github/workflows/deploy.yml` konfiguriert.

## Als App auf dem Handy installieren

Nach dem Deployment die URL im Browser öffnen:
- **iOS Safari**: Teilen-Button → "Zum Home-Bildschirm"
- **Android Chrome**: Menü → "Zum Startbildschirm hinzufügen"

Dann läuft es wie eine App im Vollbild.

## Datenhaltung

Alle Trades + Screenshots werden **lokal im Browser** (IndexedDB) gespeichert. Kein Server, keine Cloud. Das heißt:
- Daten sind privat
- Aber: Daten auf Handy und PC sind **getrennt**
- Regelmäßig Backup über **Einstellungen → Export** machen

## Struktur

```
src/
  App.jsx       ← Haupt-App
  storage.js    ← IndexedDB-Wrapper
  main.jsx      ← React-Entry
  index.css     ← Tailwind + Styles
```
