// The page Proxy (src/proxy.ts) answers with, HTTP 503, while the database
// is unreachable. Kept free of app imports beyond the theme script so the
// browser tests can load it on its own.
import { THEME_INIT_SCRIPT } from "./theme";

// The outage page wears the app's look without needing the database or the
// app's build assets: the same header mark, colours and light/dark theme
// (including a theme picked in the header, applied by the same script), and
// the app's Geist font, served from public/fonts (a path with an extension,
// so Proxy never answers it with this page).
const LIGHT = `--background: #f7f7fb; --foreground: #18181b; --muted: #52525b; --accent-soft: #eef2ff;
    --card: rgb(255 255 255 / 0.9); --card-border: rgb(228 228 231 / 0.8); --bar: rgb(255 255 255 / 0.8); --line: rgb(228 228 231 / 0.7);
    color-scheme: light;`;
const DARK = `--background: #0a0a0c; --foreground: #f4f4f5; --muted: #a1a1aa; --accent-soft: rgb(99 102 241 / 0.14);
    --card: rgb(24 24 27 / 0.8); --card-border: #27272a; --bar: rgb(9 9 11 / 0.8); --line: rgb(39 39 42 / 0.7);
    color-scheme: dark;`;

/** The outage page's HTML; `year` is for the footer. */
export function outageHtml(year: number = new Date().getFullYear()): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Can't reach the database · Outreach</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
<script>${THEME_INIT_SCRIPT}</script>
<style>
  @font-face { font-family: Geist; font-style: normal; font-weight: 100 900; font-display: swap;
    src: url(/fonts/geist-latin.woff2) format("woff2"); }
  :root { ${LIGHT} }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
  :root[data-theme="dark"] { ${DARK} }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; color: var(--foreground);
    font-family: Geist, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
    background: radial-gradient(1200px 500px at 10% -10%, var(--accent-soft), transparent),
      radial-gradient(900px 500px at 100% 0%, var(--accent-soft), transparent), var(--background); background-attachment: fixed; }
  header { border-bottom: 1px solid var(--line); background: var(--bar); padding: 12px 24px; }
  .brand { display: inline-flex; align-items: center; gap: 8px; color: inherit; text-decoration: none; font-size: 1.125rem;
    font-weight: 600; letter-spacing: -0.025em; }
  .mark { display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 8px; color: #fff;
    font-size: .875rem; font-weight: 700; background: linear-gradient(to bottom right, #6366f1, #7c3aed);
    box-shadow: 0 1px 2px rgb(79 70 229 / 0.3); }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .card { max-width: 30rem; padding: 24px; text-align: center; border-radius: 12px; border: 1px solid var(--card-border);
    background: var(--card); box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 .75rem; }
  p { margin: 0; color: var(--muted); font-size: .875rem; line-height: 1.5; }
  .btn { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; margin-top: 1rem; padding: 8px 14px;
    border-radius: 8px; color: #fff; text-decoration: none; font-weight: 500; font-size: .875rem;
    background: linear-gradient(to bottom, #6366f1, #4f46e5); box-shadow: 0 1px 2px rgb(79 70 229 / 0.2); }
  .btn:hover { background: linear-gradient(to bottom, #818cf8, #6366f1); }
  .btn:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
  footer { border-top: 1px solid var(--line); padding: 16px 24px; text-align: center; font-size: .75rem; color: var(--muted); }
</style>
</head>
<body>
<header><a class="brand" href="/" aria-label="Outreach — dashboard"><span class="mark">O</span>Outreach</a></header>
<main>
<div class="card" role="alert">
  <h1>Can't reach the database right now</h1>
  <p>Nothing can load or be saved until it's back — no emails are being sent in the meantime. Wait a minute,
  then try again. If it keeps happening, check the database provider's status page (Neon) or tell your developer.</p>
  <a class="btn" href="">Try again</a>
</div>
</main>
<footer>© ${year} Wright AI Solutions LLC</footer>
</body>
</html>`;
}
