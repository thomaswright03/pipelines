// The page Proxy (src/proxy.ts) answers with, HTTP 503, while the database
// is unreachable. Kept free of app imports beyond the theme script so the
// browser tests can load it on its own.
import { THEME_INIT_SCRIPT } from "./theme";

// The outage page wears the app's look without needing the database or the
// app's build assets: the same header mark, colours and light/dark theme
// (including a theme picked in the header, applied by the same script), and
// the app's Geist font, served from public/fonts (a path with an extension,
// so Proxy never answers it with this page).
const LIGHT = `--background: #f6f2ea; --foreground: #1b1813; --muted: #544c43; --accent-soft: rgb(86 84 214 / 0.08);
    --gold-soft: rgb(168 128 58 / 0.12); --gold-line: rgb(168 128 58 / 0.55); --card: #fffdf9; --card-border: #e6ddcf;
    --bar: rgb(250 247 241 / 0.72); --line: #e6ddcf; --shadow: 0 2px 4px rgb(60 44 20 / 0.04), 0 10px 24px -10px rgb(60 44 20 / 0.16);
    color-scheme: light;`;
const DARK = `--background: #0c0b0f; --foreground: #f3eee6; --muted: #bdb4a7; --accent-soft: rgb(150 152 255 / 0.1);
    --gold-soft: rgb(214 177 106 / 0.12); --gold-line: rgb(214 177 106 / 0.45); --card: #15141a; --card-border: #29272f;
    --bar: rgb(14 13 18 / 0.7); --line: #29272f; --shadow: 0 2px 4px rgb(0 0 0 / 0.3), 0 12px 28px -12px rgb(0 0 0 / 0.7);
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
    background: radial-gradient(1100px 520px at 8% -14%, var(--gold-soft), transparent 70%),
      radial-gradient(1000px 560px at 96% -18%, var(--accent-soft), transparent 70%), var(--background); background-attachment: fixed; }
  header { position: relative; background: var(--bar); padding: 12px 24px; backdrop-filter: saturate(1.6) blur(18px); }
  header::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
    background: linear-gradient(90deg, transparent, var(--gold-line) 30%, var(--gold-line) 70%, transparent); }
  .brand { display: inline-flex; align-items: center; gap: 8px; color: inherit; text-decoration: none; font-size: 1.125rem;
    font-weight: 600; letter-spacing: -0.025em; }
  .mark { display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 9px;
    font-size: .875rem; font-weight: 700; color: #f3e3bf; background: linear-gradient(145deg, #5b60d7, #1f2156);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), inset 0 0 0 1px rgb(214 177 106 / 0.5); }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .card { max-width: 30rem; padding: 28px; text-align: center; border-radius: 22px; border: 1px solid var(--card-border);
    background: var(--card); box-shadow: var(--shadow); }
  h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.015em; margin: 0 0 .75rem; }
  p { margin: 0; color: var(--muted); font-size: .875rem; line-height: 1.55; }
  .btn { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; margin-top: 1.1rem; padding: 8px 18px;
    border-radius: 999px; color: #fff; text-decoration: none; font-weight: 500; font-size: .875rem;
    background: linear-gradient(to bottom, #5654d6, #34328f);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.22), 0 8px 20px -10px rgb(70 68 190 / 0.5); }
  .btn:hover { background: linear-gradient(to bottom, #625fe0, #3b3999); }
  .btn:focus-visible { outline: 2px solid #5654d6; outline-offset: 2px; }
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
