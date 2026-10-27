// Applies the saved theme before first paint to avoid a flash of the wrong theme.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch {
    /* storage unavailable: fall back to the system preference */
  }
})();
