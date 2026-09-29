/**
 * Generates social-media images and explainer videos from the real app screenshots.
 *   node marketing/generate.mjs            (from the repo root; needs Google Chrome + ffmpeg on PATH)
 * Output: marketing/images/*.png, marketing/video/*.mp4
 * Screenshots come from assets/screenshots (regenerate with: SCREENSHOTS=1 npx playwright test --project=screenshots).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_IMG = path.join(ROOT, 'marketing', 'images');
const OUT_VID = path.join(ROOT, 'marketing', 'video');
const DEMO = '136-119-147-140.sslip.io';
const REPO = 'github.com/ahmedgcompany-cyber/contractrift';
mkdirSync(OUT_IMG, { recursive: true });
mkdirSync(OUT_VID, { recursive: true });

// Pages are built with setContent (about:blank), where file:// images are blocked, so inline them.
const cache = new Map();
const img = (name) => {
  if (!cache.has(name))
    cache.set(name, `data:image/png;base64,${readFileSync(path.join(ROOT, 'assets', 'screenshots', `${name}.png`)).toString('base64')}`);
  return cache.get(name);
};
const LOGO = `<svg viewBox="0 0 32 32" class="logo"><rect width="32" height="32" rx="6" fill="#1c1b18"/><path d="M4 18h7l3-9 4 15 3-9h7" fill="none" stroke="#e05a1f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600;700&family=Martian+Mono:wght@400;500&display=swap');
*{box-sizing:border-box}
body{margin:0;overflow:hidden;font-family:'Instrument Sans',sans-serif;color:#1c1b18;background:#f3f0e8;
 background-image:linear-gradient(#e4ded0 1px,transparent 1px),linear-gradient(90deg,#e4ded0 1px,transparent 1px);background-size:48px 48px}
body.dark{color:#ece8dd;background:#121210;background-image:linear-gradient(#1f1f1b 1px,transparent 1px),linear-gradient(90deg,#1f1f1b 1px,transparent 1px);background-size:48px 48px}
.logo{width:1em;height:1em;vertical-align:-0.15em}
.brand{display:flex;align-items:center;gap:.4em;font-weight:700;letter-spacing:-.02em}
.eye{font-family:'Martian Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#d9531a}
.dark .eye{color:#f0703a}
h1{margin:0;letter-spacing:-.035em;line-height:1.02}
.sub{color:#4a4740;line-height:1.4}
.dark .sub{color:#bdb8ab}
.shot{border:1px solid #d9d3c5;border-radius:14px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(0,0,0,.5);background:#fbfaf6}
.dark .shot{border-color:#2e2d28}
.shot img{display:block;width:100%}
.pill{display:inline-block;font-family:'Martian Mono',monospace;border:1px solid #b9b1a0;border-radius:99px;padding:.3em .9em;background:#fbfaf6}
.dark .pill{background:#1a1a17;border-color:#45433b}
.hl{color:#d9531a}
.dark .hl{color:#f0703a}
.trip{position:absolute;left:0;right:0;height:10px;background:linear-gradient(currentColor,currentColor) bottom/100% 2px no-repeat,repeating-linear-gradient(90deg,#9a9282 0 2px,transparent 2px 18px) bottom/100% 8px no-repeat}
`;

/** Landscape/square card: headline left, screenshot right (or below for tall formats). */
function card({
  w,
  h,
  title,
  sub,
  shot = 'dashboard-light',
  eyebrow = 'Open source · Self-hosted',
  dark = false,
  tags = ['REST', 'LLM', 'MCP'],
  footer = REPO,
  scale = 1,
}) {
  const tall = h > w * 0.9;
  const s = scale;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .wrap{position:absolute;inset:0;padding:${64 * s}px ${72 * s}px}
  .brand{font-size:${34 * s}px}
  .eye{font-size:${15 * s}px;margin-top:${tall ? 40 * s : 36 * s}px}
  h1{font-size:${(tall ? 64 : 56) * s}px;margin-top:${14 * s}px;max-width:${tall ? 100 : 46}%}
  .sub{font-size:${22 * s}px;margin-top:${18 * s}px;max-width:${tall ? 100 : 44}%}
  .tags{position:absolute;left:${72 * s}px;bottom:${60 * s}px;display:flex;gap:${10 * s}px;font-size:${15 * s}px;align-items:center}
  .shot{${tall ? `position:relative;margin-top:${56 * s}px` : `position:absolute;right:${-40 * s}px;top:${70 * s}px;width:54%`}}
  .foot{margin-left:${14 * s}px;font-family:'Martian Mono',monospace;opacity:.75}
  .trip{bottom:${30 * s}px;color:${dark ? '#ece8dd' : '#1c1b18'}}
  </style></head><body class="${dark ? 'dark' : ''}" style="width:${w}px;height:${h}px">
  <div class="wrap"><div class="brand">${LOGO}ContractRift</div>
  <div class="eye">${eyebrow}</div><h1>${title}</h1><div class="sub">${sub}</div>
  ${tall ? `<div class="shot"><img src="${img(shot)}"></div>` : ''}</div>
  ${tall ? '' : `<div class="shot"><img src="${img(shot)}"></div>`}
  <div class="tags">${tags.map((t) => `<span class="pill">${t}</span>`).join('')}<span class="foot">${footer}</span></div>
  <div class="trip"></div></body></html>`;
}

/** Product-Hunt style gallery frame: caption on top, screenshot below. */
function gallery({ w, h, caption, shot, dark = false }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .cap{position:absolute;left:60px;right:60px;top:44px;font-size:40px;font-weight:700;letter-spacing:-.02em}
  .shot{position:absolute;left:60px;right:60px;top:130px}
  </style></head><body class="${dark ? 'dark' : ''}" style="width:${w}px;height:${h}px">
  <div class="cap">${caption}</div><div class="shot"><img src="${img(shot)}"></div></body></html>`;
}

const IMAGES = [
  // X / Twitter: 16:9
  [
    'x-twitter-1600x900',
    card({
      w: 1600,
      h: 900,
      scale: 1.2,
      title: 'Your API still returns <span class="hl">200 OK</span>. The field you need is gone.',
      sub: 'ContractRift watches the contract, not just the status code — for REST APIs, LLMs and MCP servers.',
    }),
  ],
  [
    'x-twitter-drift-1600x900',
    card({
      w: 1600,
      h: 900,
      scale: 1.2,
      shot: 'drift-inbox',
      eyebrow: 'Drift inbox',
      title: 'Review upstream changes like pull requests.',
      sub: 'Breaking, warning or info. Accept to update the baseline, or dismiss.',
    }),
  ],
  // LinkedIn: link/landscape and square feed image
  [
    'linkedin-1200x627',
    card({
      w: 1200,
      h: 627,
      scale: 0.85,
      title: 'Know when your upstream APIs <span class="hl">silently change</span>.',
      sub: 'Open-source, self-hosted monitoring for REST APIs, LLMs and MCP servers.',
    }),
  ],
  [
    'linkedin-square-1200x1200',
    card({
      w: 1200,
      h: 1200,
      scale: 1.05,
      title: 'Uptime says it is up.<br>ContractRift says it <span class="hl">changed</span>.',
      sub: 'Detect removed fields, new types, model swaps and MCP tool changes — before your users do.',
    }),
  ],
  // Reddit image post (4:3)
  [
    'reddit-1200x900',
    card({
      w: 1200,
      h: 900,
      scale: 0.95,
      shot: 'drift-inbox',
      title: 'Self-hosted drift monitoring for the APIs you depend on.',
      sub: 'Your API keys stay on your own server. AGPL-3.0.',
    }),
  ],
  // dev.to cover (1000x420)
  [
    'devto-cover-1000x420',
    card({
      w: 1000,
      h: 420,
      scale: 0.62,
      title: 'Your tests mock the API. <span class="hl">The API changed anyway.</span>',
      sub: 'Watching the contract with ContractRift.',
    }),
  ],
  // TikTok / Reels / Shorts cover (9:16)
  [
    'tiktok-cover-1080x1920',
    card({
      w: 1080,
      h: 1920,
      scale: 1.25,
      dark: true,
      shot: 'dashboard-dark',
      title: 'Your API changed.<br><span class="hl">Nobody told you.</span>',
      sub: 'Open-source monitor that catches silent API, LLM and MCP changes.',
    }),
  ],
  // Instagram-style portrait, usable on LinkedIn too (4:5)
  [
    'portrait-1080x1350',
    card({
      w: 1080,
      h: 1350,
      scale: 1.05,
      title: 'Watch the <span class="hl">contract</span>, not just the status code.',
      sub: 'REST APIs · LLM APIs · MCP servers. Self-hosted, open source.',
    }),
  ],
  // Product Hunt gallery (1270x760) + thumbnail
  [
    'producthunt-1-dashboard-1270x760',
    gallery({ w: 1270, h: 760, shot: 'dashboard-light', caption: 'See what broke — outages and silent changes in one place' }),
  ],
  [
    'producthunt-2-drift-1270x760',
    gallery({ w: 1270, h: 760, shot: 'drift-inbox', caption: 'Every change classified: breaking, warning or info' }),
  ],
  [
    'producthunt-3-detail-1270x760',
    gallery({ w: 1270, h: 760, shot: 'monitor-detail', caption: 'Latency, check history and the learned baseline' }),
  ],
  [
    'producthunt-4-form-1270x760',
    gallery({ w: 1270, h: 760, shot: 'monitor-form', caption: 'REST, LLM and MCP monitors — test before you save' }),
  ],
  [
    'producthunt-5-dark-1270x760',
    gallery({ w: 1270, h: 760, shot: 'dashboard-dark', dark: true, caption: 'Self-hosted, open source, light and dark' }),
  ],
];

// ---------- video ----------
/**
 * Timeline (seconds). Each scene fades in/out; screenshots slowly zoom ("Ken Burns").
 * Rendered frame by frame via the Web Animations API for crisp output.
 */
const SCENES = [
  { t: 0, d: 3.2, big: 'Your API still returns <span class="hl">200 OK</span>.', small: 'But the field your code needs is gone.' },
  {
    t: 3.2,
    d: 4.3,
    big: 'ContractRift watches the <span class="hl">contract</span>.',
    small: 'It learns what responses look like — and alerts when they change.',
    shot: 'dashboard-light',
  },
  {
    t: 7.5,
    d: 4.5,
    big: 'Breaking changes, <span class="hl">caught</span>.',
    small: 'Removed fields, new types, new nulls. Accept or dismiss in one click.',
    shot: 'drift-inbox',
  },
  {
    t: 12,
    d: 4.2,
    big: 'REST · <span class="hl">LLM</span> · <span class="hl">MCP</span>',
    small: 'Model swaps behind your alias. MCP tools that gain required parameters.',
    shot: 'monitor-form',
  },
  {
    t: 16.2,
    d: 3.6,
    big: 'Your API keys <span class="hl">stay home</span>.',
    small: 'Self-hosted. Encrypted secrets. Open source (AGPL-3.0).',
    shot: 'monitor-detail',
  },
  { t: 19.8, d: 4.2, cta: true },
];
const TOTAL = 24;

function videoHtml({ w, h }) {
  const vertical = h > w;
  const k = vertical ? w / 1080 : h / 1080;
  const scenes = SCENES.map((s, i) => {
    const fadeIn = `fade ${0.45}s ${s.t}s both`;
    // 'forwards' only: with 'both' the fade-out's first keyframe (opacity 1) would show the scene before its turn.
    const fadeOut = `fadeout ${0.45}s ${s.t + s.d - 0.45}s forwards`;
    if (s.cta) {
      return `<section class="scene cta" style="animation:${fadeIn}">
        <div class="brand big">${LOGO}ContractRift</div>
        <div class="line">Know when your upstreams change.</div>
        <div class="pill link">▶ Live demo: ${DEMO}</div>
        <div class="pill link">★ ${REPO}</div>
        <div class="tiny">Free & open source · self-hosted</div></section>`;
    }
    return `<section class="scene" style="animation:${fadeIn},${fadeOut}">
      <div class="txt"><div class="bigtxt">${s.big}</div><div class="smalltxt">${s.small}</div></div>
      ${s.shot ? `<div class="shot" style="animation:kb ${s.d}s ${s.t}s both linear"><img src="${img(s.shot)}"></div>` : `<div class="pulse" style="animation:blink 1.2s ${s.t}s 3 both"><span class="pill">HTTP 200 OK</span><span class="pill miss">$.customer.email — missing</span></div>`}
    </section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  body{width:${w}px;height:${h}px}
  .scene{position:absolute;inset:0;display:flex;flex-direction:${vertical ? 'column' : 'row'};align-items:center;justify-content:center;gap:${60 * k}px;padding:${80 * k}px}
  .txt{${vertical ? 'text-align:center' : 'width:40%'}}
  .bigtxt{font-size:${(vertical ? 96 : 84) * k}px;font-weight:700;letter-spacing:-.035em;line-height:1.02}
  .smalltxt{font-size:${(vertical ? 44 : 40) * k}px;color:#4a4740;margin-top:${28 * k}px;line-height:1.3}
  .shot{${vertical ? 'width:100%' : 'width:58%'};border:1px solid #d9d3c5;border-radius:${18 * k}px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(0,0,0,.5);transform-origin:50% 30%}
  .shot img{display:block;width:100%}
  ${vertical ? `.shot{height:${1000 * k}px}.shot img{width:175%;max-width:none}` : ''}
  .pulse{display:flex;flex-direction:column;gap:${24 * k}px;align-items:center;font-size:${40 * k}px}
  .miss{color:#c2362b;border-color:#c2362b}
  .cta{flex-direction:column;text-align:center;gap:${40 * k}px}
  .brand.big{font-size:${110 * k}px;justify-content:center}
  .line{font-size:${56 * k}px;font-weight:600}
  .link{font-size:${(vertical ? 30 : 30) * k}px;padding:.5em 1.2em;white-space:nowrap}
  .tiny{font-family:'Martian Mono',monospace;font-size:${26 * k}px;color:#7c786e}
  .progress{position:absolute;left:0;bottom:0;height:${10 * k}px;background:#d9531a;animation:grow ${TOTAL}s 0s linear both}
  @keyframes fade{from{opacity:0;transform:translateY(${24 * k}px)}to{opacity:1;transform:none}}
  @keyframes fadeout{from{opacity:1}to{opacity:0}}
  @keyframes kb{from{transform:scale(1)}to{transform:scale(1.06)}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.55}}
  @keyframes grow{from{width:0}to{width:100%}}
  </style></head><body>${scenes}<div class="progress"></div></body></html>`;
}

async function renderVideo(browser, name, w, h) {
  const frames = path.join(OUT_VID, `.frames-${name}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(videoHtml({ w, h }), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fps = 30;
  for (let f = 0; f < TOTAL * fps; f++) {
    const ms = (f * 1000) / fps;
    await page.evaluate(
      (t) =>
        document.getAnimations().forEach((a) => {
          a.pause();
          a.currentTime = t;
        }),
      ms,
    );
    await page.screenshot({ path: path.join(frames, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.close();
  const out = path.join(OUT_VID, `${name}.mp4`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    path.join(frames, 'f%05d.jpg'),
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    out,
  ]);
  rmSync(frames, { recursive: true, force: true });
  return out;
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const [name, html] of IMAGES) {
  const [, wh] = name.match(/(\d+x\d+)$/) ?? [];
  const [w, h] = wh.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT_IMG, `${name}.png`) });
  await page.close();
  console.log('image', name);
}
if (!process.argv.includes('--images-only')) {
  console.log('video', await renderVideo(browser, 'tiktok-reels-shorts-1080x1920', 1080, 1920));
  console.log('video', await renderVideo(browser, 'linkedin-x-1920x1080', 1920, 1080));
}
await browser.close();
