// Light / Dark / System theme choice, remembered per browser in
// localStorage. Kept outside the ThemeToggle client component so the root
// layout (a server component) can inline the pre-paint script.
export const THEME_STORAGE_KEY = "theme";

/** Runs before first paint: applies a saved Light/Dark choice to <html data-theme>. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
