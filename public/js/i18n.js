// Lightweight i18n: ES/EN translations for the app chrome (nav, headers, buttons).
// Usage: element with data-i18n="key" gets its textContent replaced.
// Persisted in localStorage 'retroLang'. Default: en.
(function () {
  const I18N = {
    // Nav
    'nav.home': { en: 'Home', es: 'Inicio' },
    'nav.history': { en: 'History', es: 'Historial' },
    'nav.leaderboard': { en: 'Leaderboard', es: 'Clasificación' },
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
