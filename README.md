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

## Features

- **Live retro board** — create a retro, share the URL, and everyone joins with just a name (no login). Three columns: 😄 What Went Well, 😕 What Didn't Go Well, 💡 Action Items.
- **Real-time sync** — cards, votes and commitments update instantly for all participants via WebSockets.
- **Dot voting** — one vote per participant per card; click again to remove it.
- **Commitments Kanban** — drag commitments across ⏳ Pending / 🔄 In Progress / ✅ Done, with assignee and due date. Overdue items are highlighted in red.
- **Gamification** — completing a commitment awards **10 points** to the assignee. Global leaderboard with medals 🥇🥈🥉, plus per-retro points.
- **Retro history** — all past retros with card/commitment counts.
- **Minutes export (acta)** — download any retro as a Markdown document with participants, cards, votes and commitments.

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

## Deploy to the Cloud — Hugging Face Spaces + Neon (free, $0/month)

### 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) (free, no credit card).
2. Create a project → copy the **connection string** (`postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`).

### 2. Create the Space (Hugging Face)

1. Sign up at [huggingface.co](https://huggingface.co) (free).
2. Click **New → Space**.
3. Name: `retro-board`, SDK: **Docker** (Blank template), License: MIT, Visibility: Public (free tier requires public; the app itself has no secrets — the DB password goes in a Space secret).
4. Once created, go to **Files** tab → **Add file → Upload files** and upload:
   - `Dockerfile`, `package.json`, `package-lock.json`
   - the `src/` and `public/` folders (drag the whole folders)
5. Go to **Settings → Variables and secrets** → **New secret**:
   - Name: `DATABASE_URL`
   - Value: your Neon connection string
6. The Space restarts and builds automatically. Your app will be live at:
   `https://<your-username>-retro-board.hf.space`

> **Notes:** the free CPU tier is enough for a team retro. The Space sleeps after 48h of inactivity — just open the URL to wake it. Data is safe in Neon.

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

## Project Structure

```
retro-board/
├── src/
│   ├── server.js   # Express API + WebSocket broadcast
│   └── db.js       # Postgres pool + schema (Neon-compatible)
├── public/
│   ├── index.html        # Home: create/join retro
│   ├── retro.html        # Live board (served with ?id=)
│   ├── history.html      # Past retros
│   ├── leaderboard.html  # Gamification ranking
│   ├── css/styles.css
│   └── js/               # app.js, history.js, leaderboard.js
├── Dockerfile      # Hugging Face Spaces deployment
└── package.json
```
