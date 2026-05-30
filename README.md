# 🏭 VioV Factory Discord Bot

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue)
![Status](https://img.shields.io/badge/status-active-success)

Ein Discord-Bot, der **Fabrikdaten aus der VioV API live überwacht** und direkt in einem Discord-Channel darstellt.

Er zeigt Status, erkennt Angriffe und sendet automatische Alerts.

---

# ✨ Features

- 📊 Live-Übersicht aller Fabriken im Discord
- 🚨 @everyone Alarm bei neuen Angriffen
- 🔄 Auto-Update jede 60 Sekunden
- 🔐 OAuth2 Client-Credentials Auth
- 🟢🟠🔴 Statussystem (Attackable / Under Attack / Protected)
- 🧹 Automatische Nachrichtensäuberung
- ⏳ Capture-basierte Logik

---

# 🧠 System Überblick

Der Bot läuft permanent im Zyklus:

- Holt OAuth2 Token von der VioV API
- Fragt `/group/factories` ab
- Berechnet Status jeder Fabrik
- Aktualisiert eine einzige Embed Nachricht
- Sendet Alarm bei Statuswechsel zu „Under Attack“

---

# 📦 Installation

## 1. Requirements

- Node.js 18+
- npm oder yarn
- Discord Bot Token
- VioV API Zugang

---

## 2. Projekt clonen

```bash
git clone https://github.com/DEIN-USERNAME/viov-factory-bot.git
cd viov-factory-bot
```

---

## 3. Dependencies installieren

```bash
npm install
```

---

## 4. 🤖 Discord Bot erstellen (falls noch nicht gemacht)

- https://discord.com/developers/applications → "New Application"
- Links auf Bot → "Add Bot"
- Unter Privileged Gateway Intents nichts nötig (der Bot braucht nur Schreibrechte)
- OAuth2 → URL Generator: Scopes: bot, Bot Permissions: Send Messages, Embed Links, Mention Everyone
- Generierten Link aufrufen → Bot zu deinem Server einladen
- redirect_uri auf der Vio-V-Api-Seite auf "http://localhost/callback" setzen.

---

## 5. Environment Setup

Benne die datei ".env-example (entferne das -example sodass die datei nur .env heißt)" um zu ".env", anschließend füllst du die geforderten datei ein.

DISCORD_BOT_TOKEN= Discord Developer Portal → Deine App → Bot → "Reset Token"
DISCORD_CHANNEL_ID= In Discord: Rechtsklick auf den Ziel-Channel → "ID kopieren" (benötigt Developer Mode in Einstellungen → Erweitert)
VIOV_CLIENT_ID= Vio-V Api -> Deine Applikation Verwalten -> client_id kopieren 
VIOV_CLIENT_SECRET= Vio-V Api -> Deine Applikation Verwalten -> client_secret neugenerieren -> kopieren 

---

## 6. Bot starten

```bash
node index.js
```