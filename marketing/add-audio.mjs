/**
 * Adds an original, synthesized soundtrack to the explainer videos (no third-party music → no licensing issues):
 *  - background music: 4-chord progression (Am–F–C–G) with pad, bass, plucked arpeggio and a soft 120 BPM beat
 *  - sound effects on every scene cut: whoosh; plus an intro pop, an "alert" blip and a closing chime
 * Scene cut times must match SCENES in marketing/generate.mjs.
 *   node marketing/add-audio.mjs          (needs ffmpeg on PATH; run after generate.mjs)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const VID = path.join(ROOT, 'marketing', 'video');
const TMP = path.join(VID, '.audio');
const DUR = 24;
const CUTS = [3.2, 7.5, 12, 16.2, 19.8];
const SR = 48000;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const out = (n) => path.join(TMP, n);

// ---- music (per-channel expressions; right channel slightly detuned for width) ----
const c = 'floor(t/6)';
const f1 = `if(eq(${c},0),220,if(eq(${c},1),174.61,if(eq(${c},2),261.63,196)))`;
const f2 = `if(eq(${c},0),261.63,if(eq(${c},1),220,if(eq(${c},2),329.63,246.94)))`;
const f3 = `if(eq(${c},0),329.63,if(eq(${c},1),261.63,if(eq(${c},2),392,293.66)))`;
const env = 'min(1,mod(t,6)*1.2)*min(1,(6-mod(t,6))*1.2)';
const beat = 'mod(t,0.5)';
const eighth = 'mod(t,0.25)';
const arpNote = `if(eq(mod(floor(t*4),4),0),${f1},if(eq(mod(floor(t*4),4),1),${f2},if(eq(mod(floor(t*4),4),2),${f3},${f2})))`;
const channel = (detune) =>
  [
    `0.07*${env}*(sin(2*PI*(${f1}+${detune})*t)+sin(2*PI*(${f2}+${detune})*t)+0.8*sin(2*PI*(${f3}+${detune})*t))`, // pad
    `0.20*sin(2*PI*(${f1})/2*t)*(0.55+0.45*exp(-5*${beat}))`, // bass
    `0.055*sin(2*PI*2*(${arpNote}+${detune})*t)*exp(-14*${eighth})`, // pluck arpeggio
    `0.30*sin(2*PI*(45+90*exp(-35*${beat}))*${beat})*exp(-10*${beat})`, // soft kick
  ].join('+');
ff(
  '-f',
  'lavfi',
  '-i',
  `aevalsrc=exprs='${channel(0)}|${channel(0.8)}':s=${SR}:d=${DUR}`,
  '-af',
  `lowpass=f=5000,aecho=0.8:0.6:70|140:0.22|0.12,afade=t=in:d=1.2,afade=t=out:st=${DUR - 2.2}:d=2.2`,
  out('music.wav'),
);

// ---- sound effects ----
ff(
  '-f',
  'lavfi',
  '-i',
  `anoisesrc=d=0.7:c=pink:a=0.9:r=${SR}`,
  '-af',
  'highpass=f=350,lowpass=f=5200,afade=t=in:d=0.45:curve=exp,afade=t=out:st=0.45:d=0.25,volume=0.55,pan=stereo|c0=c0|c1=c0',
  out('whoosh.wav'),
);
ff(
  '-f',
  'lavfi',
  '-i',
  `aevalsrc='0.55*sin(2*PI*(500+900*exp(-45*t))*t)*exp(-16*t)':s=${SR}:d=0.3`,
  '-af',
  'pan=stereo|c0=c0|c1=c0',
  out('pop.wav'),
);
ff(
  '-f',
  'lavfi',
  '-i',
  `aevalsrc='0.3*sin(2*PI*660*t)*exp(-11*t)+gte(t,0.13)*0.3*sin(2*PI*440*(t-0.13))*exp(-11*(t-0.13))':s=${SR}:d=0.6`,
  '-af',
  'pan=stereo|c0=c0|c1=c0',
  out('alert.wav'),
);
ff(
  '-f',
  'lavfi',
  '-i',
  `aevalsrc='0.32*(sin(2*PI*880*t)+0.6*sin(2*PI*1318.5*t)+0.3*sin(2*PI*1760*t))*exp(-2.6*t)':s=${SR}:d=2`,
  '-af',
  'aecho=0.8:0.5:90:0.2,pan=stereo|c0=c0|c1=c0',
  out('chime.wav'),
);

// Events: [file, time in seconds, gain]
const events = [
  ['pop.wav', 0.25, 0.9], // "Your API still returns 200 OK"
  ['alert.wav', 1.35, 0.9], // "$.customer.email — missing"
  ...CUTS.map((t) => ['whoosh.wav', Math.max(0, t - 0.45), 1.6]), // whoosh leading into every cut
  ['pop.wav', 7.75, 0.6], // "Breaking changes, caught."
  ['chime.wav', 19.95, 1.0], // CTA
];
const inputs = ['-i', out('music.wav'), ...events.flatMap(([f]) => ['-i', out(f)])];
const chains = events.map(([, t, g], i) => `[${i + 1}:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=${g}[e${i}]`);
const filter = `${chains.join(';')};[0:a]volume=0.65[m];[m]${events.map((_, i) => `[e${i}]`).join('')}amix=inputs=${events.length + 1}:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11[a]`;
ff(...inputs, '-filter_complex', filter, '-map', '[a]', '-ar', String(SR), '-t', String(DUR), out('soundtrack.wav'));

for (const [src, dst] of [
  ['linkedin-x-1920x1080.mp4', 'linkedin-x-1920x1080-with-sound.mp4'],
  ['tiktok-reels-shorts-1080x1920.mp4', 'tiktok-reels-shorts-1080x1920-with-sound.mp4'],
]) {
  ff(
    '-i',
    path.join(VID, src),
    '-i',
    out('soundtrack.wav'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    path.join(VID, dst),
  );
  console.log('video with sound:', path.join(VID, dst));
}
ff('-i', out('soundtrack.wav'), '-c:a', 'libmp3lame', '-b:a', '192k', path.join(VID, 'soundtrack.mp3'));
rmSync(TMP, { recursive: true, force: true });
