// Lightweight i18n: ES/EN translations for the app chrome (nav, headers, buttons).
// Usage: element with data-i18n="key" gets its textContent replaced.
// Persisted in localStorage 'retroLang'. Default: en.
(function () {
  const I18N = {
    // Nav
    'nav.home': { en: 'Home', es: 'Inicio' },
    'nav.history': { en: 'History', es: 'Historial' },
    'nav.leaderboard': { en: 'Leaderboard', es: 'Clasificación' },
    'nav.guide': { en: 'Guide', es: 'Guía' },
    'nav.myCommitments': { en: 'My Commitments', es: 'Mis Compromisos' },
    'nav.account': { en: 'My Account', es: 'Mi Cuenta' },
    'nav.logout': { en: 'Logout', es: 'Salir' },
    'nav.login': { en: 'Login / Register', es: 'Iniciar sesión / Registrarse' },
    'nav.guest': { en: 'Guest', es: 'Invitado' },
    'nav.exitGuest': { en: 'Exit guest mode', es: 'Salir del modo invitado' },
    'nav.back': { en: '← Back', es: '← Volver' },
    // Home
    'home.title': { en: 'Retro Board', es: 'Retro Board' },
    'home.createRetro': { en: 'Create Retro', es: 'Crear Retrospectiva' },
    'home.joinRetro': { en: 'Join Retro', es: 'Unirse a Retro' },
    'home.invitationCode': { en: 'Invitation code', es: 'Código de invitación' },
    'home.myRetros': { en: 'My Retros', es: 'Mis Retros' },
    'home.dashboard': { en: 'My Commitments Dashboard', es: 'Panel de Mis Compromisos' },
    // History
    'history.title': { en: 'Past Retrospectives', es: 'Retrospectivas Anteriores' },
    'history.search': { en: 'Search title', es: 'Buscar título' },
    'history.allStatuses': { en: 'All statuses', es: 'Todos los estados' },
    'history.open': { en: 'Open', es: 'Abierta' },
    'history.closed': { en: 'Closed', es: 'Cerrada' },
    'history.clear': { en: '✕ Clear', es: '✕ Limpiar' },
    'history.openBtn': { en: 'Open', es: 'Abrir' },
    // Leaderboard
    'leaderboard.title': { en: 'Leaderboard', es: 'Clasificación' },
    // My commitments
    'mc.title': { en: 'My Commitments', es: 'Mis Compromisos' },
    // Account
    'account.title': { en: 'My Account', es: 'Mi Cuenta' },
    // Board
    'board.addCard': { en: 'Add Card', es: 'Agregar Tarjeta' },
    'board.addCommitment': { en: 'Add Commitment', es: 'Agregar Compromiso' },
    'board.timer': { 'en': 'Timer', es: 'Temporizador' },
    'board.summary': { en: 'AI Summary', es: 'Resumen IA' },
    'board.exportPdf': { en: 'Export PDF', es: 'Exportar PDF' },
    'board.exportCsv': { 'en': 'Export CSV', es: 'Exportar CSV' },
    'board.webhook': { en: 'Slack/Teams Webhook', es: 'Webhook Slack/Teams' },
    'board.autoGroup': { en: 'Auto-Group', es: 'Auto-Agrupar' },
    'board.closeRetro': { en: 'Close Retro', es: 'Cerrar Retrospectiva' },
    // Common
    'common.cancel': { en: 'Cancel', es: 'Cancelar' },
    'common.save': { en: 'Save', es: 'Guardar' },
    'common.delete': { en: 'Delete', es: 'Eliminar' },
    'common.edit': { en: 'Edit', es: 'Editar' },
    'common.back': { en: '← Back', es: '← Volver' },
    'common.loading': { en: 'Loading…', es: 'Cargando…' },
    // Guide (onboarding)
    'guide.title': { en: 'Retro Board Guide 📖', es: 'Guía de Retro Board 📖' },
    'hero.subtitle': { en: 'Everything you need to run your first retrospective in 10 minutes — from creating your account to exporting the minutes.', es: 'Todo lo que necesitas para hacer tu primera retrospectiva en 10 minutos — desde crear tu cuenta hasta exportar el acta.' },
    'guide.quickstart.title': { en: '🚀 Quick start (5 steps)', es: '🚀 Inicio rápido (5 pasos)' },
    'guide.quickstart.s1': { en: 'Create your account — click Login / Register, choose a username and password. Only the retro facilitator needs an account; participants join with just a name.', es: 'Crea tu cuenta — haz clic en Iniciar sesión / Registrarse, elige usuario y contraseña. Solo quien facilita la retrospectiva necesita cuenta; los participantes entran solo con su nombre.' },
    'guide.quickstart.s2': { en: 'Create a retro — from Home, pick a title, sprint (optional) and one of the 8 templates, or define your own columns.', es: 'Crea la retrospectiva — desde Inicio, elige un título, sprint (opcional) y una de las 8 plantillas, o define tus propias columnas.' },
    'guide.quickstart.s2b': { en: 'Share the invitation link — copy the link shown after creating the retro (it includes the invitation key) and send it to your team. They join with just their name, no login.', es: 'Comparte el link de invitación — copia el enlace que aparece al crear la retrospectiva (incluye la clave de invitación) y envíalo a tu equipo. Entran solo con su nombre, sin cuenta.' },
    'guide.quickstart.s3': { en: 'Run the retro — everyone adds cards, votes with dots, and discusses in real time. Use the timer to timebox each column.', es: 'Haz la retrospectiva — todos agregan tarjetas, votan con puntos y conversan en tiempo real. Usa el temporizador para limitar el tiempo de cada columna.' },
    'guide.quickstart.s4': { en: 'Close the loop — turn the top-voted cards into commitments with an assignee and due date, then track them in the kanban.', es: 'Cierra el ciclo — convierte las tarjetas más votadas en compromisos con responsable y fecha límite, y dales seguimiento en el kanban.' },
    'guide.invite.title': { en: '🔗 Inviting your team', es: '🔗 Invitar a tu equipo' },
    'guide.invite.p1': { en: 'Every retro is private. Access is granted only through the invitation link, which looks like /retro.html?id=7&key=abc123. Anyone with the link joins instantly with just a name.', es: 'Cada retrospectiva es privada. El acceso se otorga solo con el link de invitación, que se ve así: /retro.html?id=7&key=abc123. Cualquiera con el link entra al instante solo con su nombre.' },
    'guide.invite.li1': { en: 'Share the link in your team channel (Slack/Teams) at the start of the retro.', es: 'Comparte el link en el canal del equipo (Slack/Teams) al inicio de la retrospectiva.' },
    'guide.invite.li2': { en: 'Participants appear in the Participants list; the retro admin can see who joined.', es: 'Los participantes aparecen en la lista de Participantes; el administrador puede ver quién entró.' },
    'guide.invite.li3': { en: 'Enable anonymous mode when creating the retro if you want card authors hidden.', es: 'Activa el modo anónimo al crear la retrospectiva si quieres ocultar los autores de las tarjetas.' },
    'guide.invite.li3b': { en: 'If someone loses the link, the admin can re-share it from the retro board.', es: 'Si alguien pierde el link, el administrador puede volver a compartirlo desde el tablero.' },
    'guide.run.title': { en: '🧭 Running the session (facilitator agenda)', es: '🧭 Cómo facilitar la sesión (agenda del facilitador)' },
    'guide.run.s1': { en: 'Set the stage (2 min) — remind the team of the sprint goal and the prime directive.', es: 'Prepara el terreno (2 min) — recuerda al equipo el objetivo del sprint y la directiva prime directive.' },
    'guide.run.s2': { en: 'Gather data (10 min) — everyone adds cards to the columns. Use the timer (e.g. 5 minutes) and enable anonymous mode if the topic is sensitive.', es: 'Recolecta (10 min) — todos agregan tarjetas a las columnas. Usa el temporizador (p. ej. 5 minutos) y activa el modo anónimo si el tema es sensible.' },
    'guide.run.s2b2': { en: 'Group and discuss (10 min) — use Auto-Group to cluster similar cards, then dot-vote on the topics that matter most.', es: 'Agrupa y discute (10 min) — usa Auto-Agrupar para agrupar tarjetas similares y vota con puntos los temas más importantes.' },
    'guide.run.s3': { en: 'Decide (10 min) — take the top-voted cards and turn them into commitments: what, who, when.', es: 'Decide (10 min) — toma las tarjetas más votadas y conviértelas en compromisos: qué, quién, cuándo.' },
    'guide.run.s4': { en: 'Close — check the Team Health Score, export the minutes and share them with the team.', es: 'Cierra — revisa el Team Health Score, exporta el acta y compártela con el equipo.' },
    'guide.commitments.title': { en: '✅ Following through on commitments', es: '✅ Seguimiento de compromisos' },
    'guide.commitments.li1': { en: 'Commitments live in the kanban: drag them across Pending / In Progress / Done.', es: 'Los compromisos viven en el kanban: arrástralos entre Pendiente / En progreso / Hecho.' },
    'guide.commitments.li2': { en: 'Each one has an assignee and a due date; overdue items turn red and due-soon items show an orange badge.', es: 'Cada uno tiene responsable y fecha límite; los vencidos se pintan en rojo y los próximos a vencer muestran un badge naranja.' },
    'guide.commitments.li3': { en: 'Track yours in the My Commitments page — the nav shows a red counter for overdue items.', es: 'Consulta los tuyos en la página Mis Compromisos — el nav muestra un contador rojo de vencidos.' },
    'guide.commitments.li3b': { en: 'If someone loses the link, the admin can re-share it from the retro board.', es: 'Si alguien pierde el link, el administrador puede volver a compartirlo desde el tablero.' },
    'guide.commitments.li4': { en: 'Completing a commitment earns 10 points (+5 streak bonus if on time) on the global leaderboard.', es: 'Completar un compromiso da 10 puntos (+5 de bonus por puntualidad) en la clasificación global.' },
    'guide.commitments.li4b': { en: 'Starting the next retro? Use the carry-over option to bring pending commitments into the new retro.', es: '¿Empiezas la próxima retrospectiva? Usa la opción de carry-over para arrastrar los compromisos pendientes a la nueva.' },
    'guide.exports.title': { en: '📤 Exports & integrations', es: '📤 Exportaciones e integraciones' },
    'guide.exports.li1': { en: 'Minutes (acta) — download any retro as a Markdown document with participants, cards, votes and commitments.', es: 'Acta — descarga cualquier retrospectiva como documento Markdown con participantes, tarjetas, votos y compromisos.' },
    'guide.exports.li2': { en: 'CSV — export the commitments of any retro for spreadsheets or Jira import.', es: 'CSV — exporta los compromisos de cualquier retrospectiva para hojas de cálculo o importar a Jira.' },
    'guide.exports.li3': { en: 'JSON backup — download all your data from My Account.', es: 'Respaldo JSON — descarga todos tus datos desde Mi Cuenta.' },
    'guide.exports.li3b': { en: 'Webhooks — send retro events to Slack, Teams or any webhook endpoint (configure and test it on the board).', es: 'Webhooks — envía eventos de la retrospectiva a Slack, Teams o cualquier endpoint (configúralo y pruébalo en el tablero).' },
    'guide.demo.title': { en: '🎬 5-minute demo script', es: '🎬 Guion de demo de 5 minutos' },
    'guide.demo.intro': { en: 'Use this script to demo the tool to your squad in about 5 minutes.', es: 'Usa este guion para demostrar la herramienta a tu squad en unos 5 minutos.' },
    'guide.demo.s1': { en: '(0:00) Open Retro Board and log in. Show the Home page and the templates gallery.', es: '(0:00) Abre Retro Board e inicia sesión. Muestra la página de inicio y la galería de plantillas.' },
    'guide.demo.s2': { en: '(0:30) Create a retro called "Sprint 42 Retro" with the Classic template.', es: '(0:30) Crea una retrospectiva llamada "Sprint 42" con la plantilla Classic.' },
    'guide.demo.s3': { en: 'Copy the invitation link and open it in a second browser/incognito window — join with another name.', es: 'Copia el link de invitación y ábrelo en un segundo navegador/ventana de incógnito — entra con otro nombre.' },
    'guide.demo.s4': { en: 'Add a card in each column from both windows; show the real-time sync.', es: 'Agrega una tarjeta en cada columna desde ambas ventanas; muestra la sincronización en tiempo real.' },
    'guide.demo.s5': { en: 'Vote on a couple of cards, then run Auto-Group to cluster similar ones.', es: 'Vota un par de tarjetas y usa Auto-Agrupar para agrupar las similares.' },
    'guide.demo.s5b': { en: 'Create a commitment from a top card, set an assignee and due date, and show the kanban.', es: 'Crea un compromiso desde una tarjeta destacada, asigna responsable y fecha, y muestra el kanban.' },
    'guide.demo.s6': { en: 'Show the AI Summary, the Team Health Score and the leaderboard.', es: 'Muestra el Resumen IA, el Team Health Score y la clasificación.' },
    'guide.demo.s7': { en: 'Download the minutes (Markdown) and show the final document.', es: 'Descarga el acta (Markdown) y muestra el documento final.' },
    'guide.rollout.title': { en: '🚀 Rolling it out to your studio', es: '🚀 Lanzamiento en tu estudio' },
    'guide.rollout.li1': { en: 'Start small: pick 2–3 squads to pilot it for one sprint.', es: 'Empieza pequeño: elige 2–3 squads para pilotarlo durante un sprint.' },
    'guide.rollout.li2': { en: 'Champions: nominate one person per squad to facilitate their first retro with the tool and gather feedback.', es: 'Campeones: nombra a una persona por squad para facilitar su primera retrospectiva con la herramienta y recoger feedback.' },
    'guide.rollout.li2b': { en: 'Share the guide: send this page and the templates gallery to your squad leads.', es: 'Comparte la guía: envía esta página y la galería de plantillas a tus squad leads.' },
    'guide.rollout.li3': { en: 'Collect feedback: agree on a channel (chat group, form, or retro about the retro) so improvements keep coming.', es: 'Recoge feedback: acuerden un canal (grupo de chat, formulario o una retrospectiva sobre la retrospectiva) para seguir mejorando.' },
    'guide.rollout.li4': { en: 'Iterate: new templates, columns and features can be added based on real usage — just ask.', es: 'Itera: se pueden agregar plantillas, columnas y funciones nuevas según el uso real — solo pídelo.' },
    'guide.faq.title': { en: '❓ FAQ', es: '❓ Preguntas frecuentes' },
    'guide.faq.q1': { en: 'Do participants need an account?', es: '¿Los participantes necesitan cuenta?' },
    'guide.faq.a1': { en: 'No. Only the person who creates the retro needs an account. Everyone else joins with the invitation link and their name.', es: 'No. Solo quien crea la retrospectiva necesita cuenta. Los demás entran con el link de invitación y su nombre.' },
    'faq.q2': { en: 'Is my retro private?', es: '¿Mi retrospectiva es privada?' },
    'faq.a1': { en: 'Yes. Retro content is only visible to the retro admin and the people who join with the invitation link.', es: 'Sí. El contenido solo es visible para el administrador y quienes entren con el link de invitación.' },
  };

  function t(key) {
    const lang = localStorage.getItem('retroLang') || 'en';
    const entry = I18N[key];
    if (!entry) return key;
    return entry[lang] || entry.en;
  }

  // Apply translations to all elements with data-i18n attributes
  function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = t(key);
      if (text !== key) el.textContent = text;
    });
    // Placeholders
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const text = t(key);
      if (text !== key) el.placeholder = text;
    });
  }

  window.I18N = { t, apply: applyI18n };
})();
