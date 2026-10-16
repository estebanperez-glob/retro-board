---
title: Retro Board
emoji: 🚀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# 🚀 Retro Board

A fun, functional retrospective board for agile teams — with live collaboration, commitment tracking, assignments, gamification and exportable minutes (actas).

**Live:** https://retro-board-dimu.onrender.com

## Features

### Core board
- **Live retro board** with real-time sync (WebSockets) — cards, votes and commitments update instantly for everyone.
- **8 built-in templates**: Classic, Start/Stop/Continue, Mad-Sad-Glad, 4Ls, Sailboat, Starfish, DAKI, Wellbeing — plus custom columns (2–8) and user-defined custom templates (save/delete).
- **Dot voting** with per-participant vote tracking; **auto-group** similar cards (text clustering).
- **Sentiment badges** per card (auto sentiment analysis) and **AI-style summary** per retro.
- **Anonymous mode** and **mood tracking** per participant (feeds evolution metrics).
- **Timer** for timeboxed activities, **card drag & drop** between columns, live column counters.

### Commitments & follow-through
- **Commitments Kanban** (Pending / In Progress / Done) with assignee + due date.
- **Overdue highlighted in red**, **due-soon badge** (≤3 days, orange), in-app overdue counter badge in the nav.
- **My Commitments** page + **commitments dashboard** across retros.
- **Carry-over** — roll pending commitments into the next retro.

### Insights & gamification
- **Team Health Score** (0–100: participation 40% + vote engagement 30% + commitment follow-through 30%).
- **Evolution charts** across retros (mood avg, participation) and **Team Trends chart** in History.
- **Gamification**: 10 points per completed commitment, +5 streak bonus for on-time completion, global leaderboard with medals, per-retro points.

### Platform & UX
- **Accounts** (register/login, password recovery via security question, email/password change).
- **Private retros** — join via invitation link (`?id=N&key=CODE`); participants get access tokens; retro content only visible to admin/members.
- **Retro history** with filters (text, status, date range), duplicate retro, delete (owner only).
- **Exports**: Markdown minutes (acta), CSV of commitments, full JSON backup.
- **Webhooks** (configure + test) for integrations (Slack/Teams).
- **i18n ES/EN** toggle, **PWA** (installable, offline shell), **WCAG** accessibility (focus, skip links, aria).
- **Admin panel** (master): page views, users management, stats.
- **Miro Playful visual identity** (light/dark theme), empty states, Ctrl+Enter to send, templates gallery page.

## Tech Stack

- **Backend:** Node.js, Express, ws (WebSockets), pg (Postgres client)
- **Frontend:** Vanilla JS + CSS, no build step
- **Database:** Postgres (Neon free tier) — schema auto-created on startup

## Run Locally

```bash
npm install
# Paste your Neon connection string into the .env file (DATABASE_URL=...)
npm.cmd start
# → http://localhost:3000
```

## API Overview

| Method | Path | Description |
| --- | --- | --- |
| GET/POST | `/api/retros` | List / create retros |
| POST | `/api/retros/:id/join` | Join with a name |
| GET/POST | `/api/retros/:id/cards` | List / add cards |
| POST | `/api/cards/:id/vote` | Toggle vote |
| GET/POST | `/api/retros/:id/commitments` | List / add commitments |
| PUT | `/api/commitments/:id` | Update status/assignee/due date |
| GET | `/api/leaderboard` | Global points ranking |
| GET | `/api/retros/:id/acta` | Download minutes (Markdown) |
| GET | `/api/health-score` | Team Health Score |
| GET | `/api/backup.json` | Full JSON backup |

## Project Structure

```
retro-board/
├── src/
│   ├── server.js          # Bootstrap
│   ├── db.js              # Postgres pool + schema (Neon-compatible)
│   ├── helpers.js         # Auth, sessions, access checks, rate limit
│   ├── ws.js              # WebSocket broadcast
│   ├── text.js            # Tokenize / sentiment
│   └── routes/            # auth, retros, cards, commitments, admin, insights
├── public/
│   ├── index.html         # Home: create/join retro
│   ├── retro.html         # Live board (served with ?id=)
│   ├── onboarding.html    # Guide (EN/ES)
│   ├── templates.html     # Templates gallery
│   ├── history.html       # Past retros
│   ├── leaderboard.html   # Gamification ranking
│   ├── my-commitments.html# Personal commitments
│   ├── account.html       # Account settings
│   └── admin.html         # Admin panel (master)
├── Dockerfile
└── package.json
```

---

## 🇪🇸 Retro Board (Español)

Un tablero de retrospectivas divertido y funcional para equipos ágiles, con colaboración en vivo, seguimiento de compromisos, gamificación y actas exportables.

**URL:** https://retro-board-dimu.onrender.com

### Características principales

- **Tablero en tiempo real** (WebSockets): tarjetas, votos y compromisos se actualizan al instante para todos.
- **8 plantillas integradas** (Classic, Start/Stop/Continue, Mad-Sad-Glad, 4Ls, Sailboat, Starfish, DAKI, Wellbeing), columnas personalizadas y plantillas propias guardables.
- **Votación con puntos**, **auto-agrupado** de tarjetas similares, **badges de sentimiento** y **resumen IA**.
- **Kanban de compromisos** con responsable y fecha límite; vencidos en rojo, próximos a vencer en naranja.
- **Gamificación**: 10 puntos por compromiso completado (+5 bonus por puntualidad), clasificación global con medallas.
- **Team Health Score** (0–100), gráficos de evolución y tendencias entre retrospectivas.
- **Retros privadas** con link de invitación; solo el facilitador necesita cuenta.
- **Exportación**: acta en Markdown, CSV de compromisos, respaldo JSON completo.
- **Webhooks** para Slack/Teams, **i18n ES/EN**, **PWA instalable** y accesibilidad WCAG.

### Cómo empezar

1. Entra a la app y crea tu cuenta (solo quien facilita la retrospectiva).
2. Crea una retrospectiva desde Inicio eligiendo una de las 8 plantillas.
3. Comparte el link de invitación con tu equipo (entran solo con su nombre).
4. Agreguen tarjetas, voten y conviertan lo más votado en compromisos.
5. Consulta la **Guía** dentro del sitio para el paso a paso completo.
