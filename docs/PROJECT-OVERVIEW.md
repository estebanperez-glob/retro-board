# Retro Board — Documentación del Proyecto

> Tablero de retrospectivas ágiles con colaboración en tiempo real, tracking de compromisos, gamificación y actas exportables.
>
> **Producción**: https://retro-board-dimu.onrender.com
> **Repo**: github.com/estebanperez-glob/retro-board
> **DB**: Postgres en Neon (free tier)

---

## 1. Qué es y para qué sirve

Retro Board es una aplicación web para que equipos ágiles ejecuten retrospectivas de sprint de forma colaborativa y en tiempo real:

- El facilitador crea una retro, comparte el link de invitación y el equipo entra solo con su nombre (sin login para participantes)
- El equipo escribe cards en columnas temáticas, las prioriza con dot voting y convierte los hallazgos en compromisos con responsable y fecha
- Al completar un compromiso, el responsable gana 10 puntos — gamificación con leaderboard global

**El problema que resuelve**: las retros en pizarras o herramientas genéricas no dejan trazabilidad. Aquí cada retro deja un acta exportable, un historial consultable y compromisos con seguimiento hasta su cierre, con puntos para quien cumple.

---

## 2. Funcionalidades

### 2.1 Tablero de retro
- Creación de retro con título, sprint y plantilla (4 plantillas, ver §3)
- Participación sin login: solo nombre + link de invitación
- Cards con autor, votos y edición (solo autor o admin)
- Dot voting: 1 voto por participante por card, click de nuevo para quitar
- Drag & drop de cards entre columnas (toda la columna es drop target, columnas vacías incluidas)
- Retro cerrada/reabierta por el admin; al cerrar se congela la edición

### 2.2 Compromisos (commitments)
- Kanban de 3 estados: ⏳ Pending / 🔄 In Progress / ✅ Done
- Drag & drop entre estados con sincronización en vivo
- Assignee + due date; vencidos resaltados en rojo
- Completar un compromiso otorga 10 puntos al assignee

### 2.3 Gamificación
- 10 puntos por compromiso completado (al assignee)
- Leaderboard global con medallas 🥇🥈🥉
- Puntos por retro y leaderboard por retro

### 2.4 Historia y análisis
- Historial de todas las retros con conteos de cards/compromisos
- Dashboard de compromisos (pendientes, vencidos, completados)
- Evolución de sentimiento entre retros (cards positivas vs negativas)

### 2.5 Acta (minutes)
- Export .MD: descarga directa del acta en Markdown
- Export PDF: vista imprimible + diálogo de impresión (Save as PDF)
- Incluye participantes, cards por columna con votos y compromisos con estado

### 2.6 Cuenta y seguridad de usuario
- Registro/login con usuario y contraseña (bcrypt)
- Pregunta de seguridad para recuperación de contraseña
- My Account: cambiar contraseña, pregunta de seguridad, email para notificaciones

### 2.7 Tema claro/oscuro
- Toggle en el nav de todas las páginas
- Persistencia en localStorage, sin flash al cargar

### 2.8 Notificaciones email (pospuesto)
- Scheduler cada 6h consulta compromisos vencidos de usuarios con notify_overdue=true
- Sin env vars SMTP configuradas, el mailer queda deshabilitado (getMailer devuelve null)
- **Estado**: código desplegado e inactivo; activación pospuesta por decisión del usuario

---

## 3. Plantillas de retro

| Plantilla | Columnas |
|---|---|
| **Classic** | What Went Well / What Didn't Go Well / Action Items |
| **SSC** | Start Doing / Stop Doing / Continue Doing |
| **Mad-Sad-Glad** | Mad / Sad / Glad |
| **4LS** | Liked / Learned / Lacked / Longed For |

---

## 4. Cómo funciona (arquitectura)

### 4.1 Stack
- **Backend**: Node.js + Express + ws (WebSockets) + pg (Postgres)
- **Frontend**: Vanilla JS + CSS, sin build step
- **DB**: Postgres en Neon (free tier), schema auto-creado al arranque
- **Deploy**: Render free tier, auto-deploy desde `main`

### 4.2 Modelo de datos

| Tabla | Contenido |
|---|---|
| `retros` | Título, sprint, estado, plantilla, anonimato, join_code, created_by |
| `participants` | Participantes por retro (nombre + access_token) |
| `cards` | Cards por retro (contenido, autor, columna) |
| `votes` | Votos por card y participante (1 por persona por card) |
| `commitments` | Compromisos (título, descripción, assignee, due_date, status) |
| `points` | Puntos por completar compromisos (user, retro, amount) |
| `users` | Usuarios con login (password hash, security question, email, notify_overdue) |
| `sessions` | Sesiones de login (token → user) |

### 4.3 Tiempo real (WebSockets)
- Al entrar a una retro, el cliente abre un WS con token por query params (userToken o participantToken)
- El servidor valida el token al conectar y agrega el socket a la sala de la retro
- Cada mutación hace `broadcast()` a la sala: `card_added/updated/deleted`, `commitment_added/updated/deleted`, `participants_changed`, `retro_closed/reopened/deleted`
- Reconexión automática con backoff exponencial

### 4.4 Notificaciones email (inactivo)
- Scheduler cada 6h consulta compromisos vencidos de usuarios con notify_overdue=true
- `getMailer()` devuelve null sin las env vars SMTP → feature deshabilitada sin configuración
- Para activar: agregar SMTP_HOST/PORT/USER/PASS/FROM en Render → Environment

---

## 5. Seguridad

- **Retros privadas**: contenido solo accesible por admin o miembros (`requireRetroAccess`)
- **join_code + link de invitación**: `retro.html?id=N&key=CODE` — sin el key no se entra
- **access_token por participante** (header `X-Participant-Token`) para mutaciones
- **WS validado por query params** (userToken/participantToken) al conectar
- **Historial/dashboard/evolution/leaderboard**: solo login, filtrado por created_by
- **Rate limiting** en register/login/forgot-password
- **bcrypt** para passwords y respuestas de seguridad
- **Acta**: acepta token por query param (para el link de descarga .MD)

---

## 6. Despliegue

### 6.1 Producción
- **URL**: https://retro-board-dimu.onrender.com
- **Deploy**: auto-deploy desde `main` (GitHub); tras push puede requerir manual redeploy si no refresca en ~10 min
- **Plan**: Render free tier (duerme tras 15 min de inactividad, cold start ~30-50s)
- **DB**: Postgres en Neon free tier, schema auto-creado al arranque (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS para migraciones)

### 6.2 Env vars (Render)

| Variable | Requerida | Uso |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string de Neon |
| `SESSION_SECRET` | ✅ | Firma de sesiones |
| `SMTP_HOST/PORT/USER/PASS/FROM` | ❌ | Solo si se activa email (pospuesto) |

> Render trackea `main` — push a main = deploy. El branch `master` quedó como espejo local.

---

## 7. Proceso de uso recomendado

### 7.1 Antes de la retro
1. El facilitador crea la retro (título, sprint, plantilla)
2. Comparte el link de invitación (botón Copy link)

### 7.2 Durante
1. Cada quien agrega cards en las columnas
2. Fase de votación: dot voting para priorizar
3. Se discuten las top cards
4. Se crean compromisos con assignee + due date

### 7.3 Cierre
1. El facilitador cierra la retro (congela la edición)
2. Export del acta (.MD o PDF) y se comparte
3. Los compromisos se siguen en el kanban entre sprints
4. Al completar un compromiso → 10 puntos al assignee

### 7.4 Entre sprints
- Revisar leaderboard y evolución de sentimiento
- Llevar compromisos pendientes (carry over) a la próxima retro

---

## 8. Estructura del código

```
retro-board/
├── src/
│   ├── server.js      # Express + WS + todas las rutas API
│   └── db.js          # Postgres (Neon) + schema + migraciones
├── public/
│   ├── index.html     # Home: crear/entrar a retros
│   ├── retro.html     # Tablero de retro
│   ├── history.html   # Historial de retros
│   ├── leaderboard.html
│   ├── account.html   # My Account
│   ├── css/styles.css # Estilos (tema oscuro/claro)
│   └── js/
│       ├── auth.js         # Nav, login/registro, tema
│       ├── app.js          # Tablero, kanban, acta, WS
│       ├── account.js      # My Account UI
│       ├── history.js      # Historial + dashboard + evolution
│       └── leaderboard.js  # Leaderboard UI
├── Dockerfile / render.yaml
└── README.md
```

---

## 9. API (resumen de endpoints)

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/register` / `/api/login` / `/api/logout` | Auth de usuarios |
| GET/PUT | `/api/account` (+ password, security-question, email) | My Account |
| GET/POST | `/api/retros` | Listar (solo login) / crear retro |
| GET | `/api/retros/:id` | Detalle (admin o miembro) |
| POST | `/api/retros/:id/join` | Unirse con join_code |
| POST | `/api/retros/:id/close` / `reopen` | Cerrar/reabrir (admin) |
| GET/POST | `/api/retros/:id/cards` | Listar/crear cards |
| PUT/DELETE | `/api/cards/:id` | Editar/mover/eliminar card |
| POST | `/api/cards/:id/vote` | Votar/quitar voto |
| GET/POST | `/api/retros/:id/commitments` | Listar/crear compromisos |
| PUT/DELETE | `/api/commitments/:id` | Editar/mover/eliminar compromiso |
| GET | `/api/commitments-dashboard` | Dashboard de compromisos (login) |
| GET | `/api/evolution` | Evolución de sentimiento (solo login) |
| GET | `/api/leaderboard` | Leaderboard global |
| GET | `/api/retros/:id/acta` | Acta en Markdown (token por query o header) |
| GET | `/api/health` | Health check |

---

## 10. Gotchas del entorno

- PowerShell bloquea npm.ps1 → usar `npm.cmd`
- Render trackea `main`; `master` es espejo local
- TLS inspection corporativo: curl necesita `--ssl-no-revoke`
- Render free tier duerme tras 15 min (cold start 30-50s)
- `node --check` antes de cada commit; push a main = deploy
- Migraciones: ALTER TABLE ADD COLUMN IF NOT EXISTS en db.js (CREATE TABLE IF NOT EXISTS no migra tablas ya creadas)
