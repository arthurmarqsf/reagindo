/* Reagindo — app de react ao vivo (PWA, sem build). */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const vid = $('#vid'), cam = $('#cam'), cv = $('#cv'), ctx = cv.getContext('2d');
const box = $('#frameBox');

/* ================= estado ================= */
const DEF = {
  layout: 'split', split: 0.42, camTop: true, camSize: 0.38, camShape: 'circle', camX: 0.76, camY: 0.2,
  mirror: true, facing: 'user', fill: false, vol: 1, duck: true, badge: true, autoClear: true,
  zoom: 1, offX: 0, offY: 0, camZoom: 1, camOffX: 0, camOffY: 0, ytVertical: false, sfxVol: 0.8, tbCollapsed: false,
};
const S = Object.assign({}, DEF, load());
const R = { source: null, paused: true, bubble: '', moments: [], recording: false, particles: [], talking: 0,
  yt: null, ytReady: false, recStart: 0 };
function load() { try { return JSON.parse(localStorage.getItem('reagindo2') || '{}'); } catch { return {}; } }
function save() { try { localStorage.setItem('reagindo2', JSON.stringify(S)); } catch {} }
const isYT = () => !!R.source && R.source.type === 'yt';
const fmt = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
function toast(m, ms = 2400) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }

/* ================= sheets ================= */
function closeSheets() { $$('.sheet').forEach((s) => s.classList.remove('open')); $('#scrim').classList.remove('on'); }
function openSheet(id) { const s = $(id), was = s.classList.contains('open'); closeSheets(); if (!was) { s.classList.add('open'); $('#scrim').classList.add('on'); } }
$('#scrim').addEventListener('click', closeSheets);
$('#mediaBtn').addEventListener('click', () => openSheet('#mediaSheet'));
$('#tbMedia').addEventListener('click', () => openSheet('#mediaSheet'));
$('#addMedia').addEventListener('click', () => openSheet('#mediaSheet'));
$('#settingsBtn').addEventListener('click', () => openSheet('#settingsSheet'));
$('#tbMoments').addEventListener('click', () => openSheet('#momentsSheet'));
$('#balloonBtn').addEventListener('click', () => { if (!R.paused) pauseMedia(); openSheet('#balloonSheet'); setTimeout(() => $('#commentText').focus(), 300); });
$('#tbReact').addEventListener('click', () => { const on = $('#emojiBar').classList.toggle('hidden'); $('#soundBar').classList.toggle('hidden', on); $('#tbReact').classList.toggle('on', !on); });
$('#tbToggle').addEventListener('click', () => { S.tbCollapsed = !S.tbCollapsed; save(); applyUI(); });

/* ================= mídia ================= */
$('#file').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  setSource({ type: 'file', url: URL.createObjectURL(f), name: f.name });
});
function ytId(u) {
  u = (u || '').trim();
  const m = u.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || u.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
$('#ytGo').addEventListener('click', () => {
  const u = $('#ytUrl').value, id = ytId(u);
  if (!id) return toast('Link do YouTube inválido');
  if (/\/shorts\//.test(u)) S.ytVertical = true; else if (/watch|youtu\.be/.test(u)) S.ytVertical = false;
  save(); setSource({ type: 'yt', id });
});
$('#ytUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ytGo').click(); });
$('#clearMedia').addEventListener('click', () => { setSource(null); closeSheets(); });

function setSource(src) {
  if (R.recording) return toast('Pare a gravação antes de trocar o vídeo');
  ensureAudio();
  pauseMedia();
  if (R.source && R.source.url) URL.revokeObjectURL(R.source.url);
  R.source = src; R.moments = []; renderMoments(); R.bubble = ''; S.zoom = 1; S.offX = 0; S.offY = 0;
  document.body.classList.toggle('yt', isYT());
  if (!src) { vid.removeAttribute('src'); vid.load(); stopYT(); }
  else if (src.type === 'yt') { vid.removeAttribute('src'); vid.load(); loadYT(src.id); }
  else { stopYT(); vid.src = src.url; vid.load(); }
  setPaused(true); applyUI(); closeSheets();
  if (src) toast(isYT() ? 'YouTube carregado. Toque no ▶ pra começar' : 'Vídeo carregado. Toque no ▶ ou no vídeo');
}

/* ================= YouTube ================= */
let ytApi = null;
function ytApiReady() {
  return ytApi || (ytApi = new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }));
}
async function loadYT(id) {
  await ytApiReady();
  if (R.yt && R.ytReady) { R.yt.cueVideoById(id); return; }
  R.yt = new YT.Player('yt', {
    videoId: id, width: '100%', height: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: () => { R.ytReady = true; },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) onPlay();
        else if (e.data === YT.PlayerState.PAUSED) onPause();
        else if (e.data === YT.PlayerState.ENDED) setPaused(true);
      },
      onError: (e) => toast(e.data === 101 || e.data === 150 ? 'Esse vídeo não permite ser incorporado. Tente outro.' : 'Erro no YouTube (' + e.data + ')', 4000),
    },
  });
}
function stopYT() { if (R.yt && R.ytReady) try { R.yt.stopVideo(); } catch {} }

/* ================= reprodução ================= */
const curTime = () => isYT() ? (R.ytReady ? R.yt.getCurrentTime() || 0 : 0) : vid.currentTime || 0;
const duration = () => isYT() ? (R.ytReady ? R.yt.getDuration() || 0 : 0) : (vid.duration || 0);
function seek(t) { t = Math.max(0, Math.min(duration() || 0, t)); if (isYT()) { R.ytReady && R.yt.seekTo(t, true); } else vid.currentTime = t; }
function playMedia() {
  ensureAudio(); if (!R.source) return openSheet('#mediaSheet');
  if (isYT()) { if (R.ytReady) R.yt.playVideo(); setTimeout(() => { if (R.paused && isYT()) toast('Se não começar, toque no vídeo do YouTube'); }, 1500); }
  else vid.play().catch((e) => toast('Não deu play: ' + e.message));
}
function pauseMedia() { if (isYT()) { R.ytReady && R.yt.pauseVideo(); } else if (!vid.paused) vid.pause(); }
function togglePlay() { R.paused ? playMedia() : pauseMedia(); }
function onPlay() { setPaused(false); if (S.autoClear) R.bubble = ''; }
function onPause() {
  const t = curTime(), d = duration();
  if (!R.paused && !(d && t >= d - 0.3)) { R.moments.push({ t, text: '' }); renderMoments(); }
  setPaused(true);
}
function setPaused(p) {
  R.paused = p; const b = $('#playBtn');
  b.innerHTML = `<svg><use href="#i-${p ? 'play' : 'pause'}"/></svg>`; b.classList.toggle('paused', p);
}
vid.addEventListener('play', onPlay);
vid.addEventListener('pause', onPause);
vid.addEventListener('ended', () => setPaused(true));
$('#playBtn').addEventListener('click', togglePlay);
const seekBar = $('#seekBar'); let seeking = false;
seekBar.addEventListener('input', () => { seeking = true; $('#tCur').textContent = fmt(seekBar.value / 1000 * duration()); });
seekBar.addEventListener('change', () => { seek(seekBar.value / 1000 * duration()); seeking = false; });
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowLeft') seek(curTime() - 5);
  if (e.key === 'ArrowRight') seek(curTime() + 5);
});

/* balão + momentos */
$('#commentShow').addEventListener('click', () => {
  R.bubble = $('#commentText').value.trim();
  const last = R.moments[R.moments.length - 1];
  if (R.bubble && R.paused && last && Math.abs(last.t - curTime()) < 1.5) { last.text = R.bubble; renderMoments(); }
  $('#commentText').value = ''; $('#commentText').blur(); closeSheets();
});
$('#commentClear').addEventListener('click', () => { R.bubble = ''; closeSheets(); });
function renderMoments() {
  const ol = $('#momentsList'); ol.innerHTML = '';
  R.moments.forEach((m) => {
    const li = document.createElement('li'); li.innerHTML = '<b>' + fmt(m.t) + '</b> ';
    li.append(document.createTextNode(m.text || 'pausa'));
    li.addEventListener('click', () => { seek(m.t); closeSheets(); }); ol.appendChild(li);
  });
}
$('#copyMoments').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(R.moments.map((m) => fmt(m.t) + ' ' + (m.text || 'pausa')).join('\n')); toast('Copiado!'); }
  catch { toast('Não consegui copiar'); }
});

/* ================= ajustes ================= */
const RANGES = ['camSize', 'vol', 'zoom', 'offX', 'offY', 'sfxVol'];
const TOGGLES = ['camTop', 'duck', 'badge', 'fill', 'autoClear', 'ytVertical'];
RANGES.forEach((k) => $('#' + k).addEventListener('input', (e) => { S[k] = +e.target.value; save(); }));
TOGGLES.forEach((k) => $('#' + k).addEventListener('change', (e) => { S[k] = e.target.checked; save(); }));
$$('[data-layout]').forEach((b) => b.addEventListener('click', () => {
  if (R.recording) return toast('Pare a gravação pra trocar o formato');
  S.layout = b.dataset.layout; save(); applyUI();
}));
$$('#shapeSeg button').forEach((b) => b.addEventListener('click', () => { S.camShape = b.dataset.shape; save(); applyUI(); }));
$('#resetVideo').addEventListener('click', () => { S.zoom = 1; S.offX = 0; S.offY = 0; save(); applyUI(); });
$('#mirrorBtn').addEventListener('click', () => { S.mirror = !S.mirror; save(); applyUI(); toast(S.mirror ? 'Câmera espelhada' : 'Câmera normal'); });
$('#tbFlip').addEventListener('click', async () => {
  S.facing = S.facing === 'user' ? 'environment' : 'user'; S.mirror = S.facing === 'user'; save(); applyUI();
  try { await getCam(); } catch { toast('Não deu pra trocar a câmera'); }
});
function applyUI() {
  RANGES.forEach((k) => { $('#' + k).value = S[k]; });
  TOGGLES.forEach((k) => { $('#' + k).checked = S[k]; });
  $$('[data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === S.layout));
  $$('#shapeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.shape === S.camShape));
  $('#mirrorBtn').classList.toggle('on', !S.mirror);
  $('.tbrow').classList.toggle('collapsed', S.tbCollapsed);
  $('#playbar').classList.toggle('hidden', !R.source);
  $('#addMedia').classList.toggle('hidden', !!R.source);
  $('#splitPill').classList.toggle('hidden', S.layout !== 'split');
  $('#ytOnly').classList.toggle('hidden', !isYT());
  sizeFrame();
}

/* ================= câmera + áudio ================= */
let camStream = null, micStream = null;
let ac = null, recDest = null, vidGain = null, sfxGain = null, analyser = null, micData = null, micNode = null;
async function getCam() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  const s = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: micStream ? false : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  camStream = new MediaStream(s.getVideoTracks()); cam.srcObject = camStream; cam.play().catch(() => {});
  if (!micStream && s.getAudioTracks().length) { micStream = new MediaStream(s.getAudioTracks()); hookMic(); }
}
function ensureAudio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    recDest = ac.createMediaStreamDestination();
    analyser = ac.createAnalyser(); analyser.fftSize = 1024; micData = new Uint8Array(analyser.fftSize);
    vidGain = ac.createGain(); const src = ac.createMediaElementSource(vid);
    src.connect(vidGain); vidGain.connect(ac.destination); vidGain.connect(recDest);
    sfxGain = ac.createGain(); sfxGain.connect(ac.destination); sfxGain.connect(recDest);
  }
  if (ac.state !== 'running') ac.resume();
  hookMic();
}
function hookMic() {
  if (!ac || !micStream || micNode) return;
  micNode = ac.createMediaStreamSource(micStream); micNode.connect(analyser); micNode.connect(recDest);
}
document.addEventListener('pointerdown', () => ensureAudio(), { once: true });
document.addEventListener('touchend', () => ensureAudio(), { once: true });

/* ================= sons de reação (gravações reais em /sons) ================= */
const SOUNDS = [
  ['risada', '😂', 'Risada'], ['plateia', '🎭', 'Plateia'], ['aplausos', '👏', 'Aplausos'], ['buzina', '📯', 'Buzina'],
  ['rufar', '🥁', 'Rufar'], ['triste', '🎺', 'Triste'], ['grilo', '🦗', 'Grilo'], ['explosao', '💥', 'Boom'], ['campainha', '🔔', 'Ding'],
];
const bufs = {}, playing = new Map();
async function getBuf(key, url) {
  if (bufs[key]) return bufs[key];
  const ab = await (await fetch(url)).arrayBuffer();
  bufs[key] = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));
  return bufs[key];
}
async function playSound(key, url, btn) {
  ensureAudio(); sfxGain.gain.value = S.sfxVol;
  if (playing.has(key)) { try { playing.get(key).stop(); } catch {} return; } // tocar de novo = parar
  try {
    const n = ac.createBufferSource(); n.buffer = await getBuf(key, url); n.connect(sfxGain); n.start();
    playing.set(key, n); btn.classList.add('hit');
    n.onended = () => { playing.delete(key); btn.classList.remove('hit'); };
  } catch (e) { console.warn(e); toast('Não consegui tocar esse som'); }
}
function soundBtn(key, icon, label, url, custom) {
  const b = document.createElement('button'); b.className = 'snd';
  b.innerHTML = '<i></i><span></span>'; b.querySelector('i').textContent = icon; b.querySelector('span').textContent = label;
  b.addEventListener('click', () => { if (b.dataset.longpress) { delete b.dataset.longpress; return; } playSound(key, url, b); });
  if (custom) {
    let t; b.addEventListener('pointerdown', () => { t = setTimeout(() => { b.dataset.longpress = 1; removeCustom(key); }, 800); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(t)));
  }
  return b;
}
// sons do próprio usuário: ficam salvos no aparelho (IndexedDB)
function dbOpen() { return new Promise((res, rej) => { const r = indexedDB.open('reagindo', 1); r.onupgradeneeded = () => r.result.createObjectStore('sons', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbAll() { try { const db = await dbOpen(); return await new Promise((res) => { const q = db.transaction('sons').objectStore('sons').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch { return []; } }
async function dbTx(fn) { const db = await dbOpen(); return new Promise((res, rej) => { const t = db.transaction('sons', 'readwrite'); fn(t.objectStore('sons')); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function renderSounds() {
  const bar = $('#soundBar'); bar.innerHTML = '';
  SOUNDS.forEach(([k, i, l]) => bar.appendChild(soundBtn(k, i, l, 'sons/' + k + '.m4a')));
  for (const c of await dbAll()) bar.appendChild(soundBtn(c.id, '🎵', c.name, URL.createObjectURL(c.blob), true));
  const add = document.createElement('button'); add.className = 'snd add'; add.innerHTML = '<i>＋</i><span>Meu som</span>';
  add.addEventListener('click', () => $('#sndFile').click()); bar.appendChild(add);
}
$('#sndFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const name = (prompt('Nome do botão:', f.name.replace(/\.[^.]+$/, '').slice(0, 12)) || 'Som').slice(0, 12);
  try { await dbTx((st) => st.put({ id: 'u' + Date.now(), name, blob: f })); await renderSounds(); toast('Som adicionado! Segure o botão pra apagar'); }
  catch { toast('Não consegui salvar o som'); }
});
async function removeCustom(id) { if (!confirm('Apagar esse som?')) return; await dbTx((st) => st.delete(id)); delete bufs[id]; renderSounds(); }
renderSounds();

/* emojis */
$$('#emojiBar button[data-e]').forEach((b) => b.addEventListener('click', () => burst(b.dataset.e)));
function burst(e) {
  const W = cv.width, H = cv.height;
  for (let i = 0; i < 8; i++) R.particles.push({ e, x: W * (0.2 + Math.random() * 0.6), y: H * 0.9, vx: (Math.random() - 0.5) * W * 0.004,
    vy: -H * (0.006 + Math.random() * 0.007), s: W * (0.07 + Math.random() * 0.06), life: 1, rot: (Math.random() - 0.5) * 0.6 });
}

/* ================= geometria ================= */
function canvasSize() { return S.layout === 'pip169' ? [1280, 720] : [720, 1280]; }
function sizeFrame() {
  const [W, H] = canvasSize();
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const vw = innerWidth, vh = innerHeight, sc = Math.min(vw / W, vh / H), w = W * sc, h = H * sc;
  box.style.width = w + 'px'; box.style.height = h + 'px';
  box.style.top = (S.layout === 'pip169' ? Math.max(0, (vh - h) / 2 - 90) : 0) + 'px';
  $('.dl').style.bottom = '';
}
addEventListener('resize', sizeFrame);
addEventListener('orientationchange', () => setTimeout(sizeFrame, 300));

function layout(W, H) {
  if (S.layout === 'split') {
    const a = S.camTop ? S.split : 1 - S.split, top = { x: 0, y: 0, w: W, h: H * a }, bot = { x: 0, y: H * a, w: W, h: H * (1 - a) };
    return S.camTop ? { cam: top, video: bot, shape: 'full', line: H * a } : { video: top, cam: bot, shape: 'full', line: H * a };
  }
  const s = S.camSize * Math.min(W, H) * (S.layout === 'pip169' ? 1 : 1.15), w = s, h = S.camShape === 'circle' ? s : s * 1.25;
  const x = Math.max(0, Math.min(W - w, S.camX * W - w / 2)), y = Math.max(0, Math.min(H - h, S.camY * H - h / 2));
  return { video: { x: 0, y: 0, w: W, h: H }, cam: { x, y, w, h }, shape: S.camShape };
}
function contentRect(r, aspect, fill) {
  const sc = fill ? Math.max(r.w / aspect, r.h) : Math.min(r.w / aspect, r.h);
  const dw = aspect * sc * S.zoom, dh = sc * S.zoom;
  return { x: r.x + (r.w - dw) / 2 + S.offX * r.w, y: r.y + (r.h - dh) / 2 + S.offY * r.h, w: dw, h: dh };
}
function camRect(r, aspect) {
  const sc = Math.max(r.w / aspect, r.h) * S.camZoom, w = aspect * sc, h = sc;
  return { x: r.x + (r.w - w) / 2 + S.camOffX * r.w, y: r.y + (r.h - h) / 2 + S.camOffY * r.h, w, h };
}
const pct = (v, t) => (v / t * 100) + '%';
let ytKey = '';
function placeOverlays(L) {
  const W = cv.width, H = cv.height, v = L.video;
  if (isYT()) {
    const c = contentRect(v, S.ytVertical ? 9 / 16 : 16 / 9, S.fill), key = [v.x, v.y, v.w, v.h, c.x, c.y, c.w, c.h].join();
    if (key !== ytKey) {
      ytKey = key; const w = $('#ytWrap').style;
      w.left = pct(v.x, W); w.top = pct(v.y, H); w.width = pct(v.w, W); w.height = pct(v.h, H);
      const f = $('#yt'); if (f) { f.style.left = pct(c.x - v.x, v.w); f.style.top = pct(c.y - v.y, v.h); f.style.width = pct(c.w, v.w); f.style.height = pct(c.h, v.h); }
    }
  }
  const am = $('#addMedia').style; am.left = pct(v.x + v.w / 2, W); am.top = pct(v.y + v.h / 2, H);
  if (L.line != null) { const sp = $('#splitPill').style; sp.left = '50%'; sp.top = pct(L.line, H); }
  const ch = $('#camHit').style;
  if (L.shape === 'full') ch.display = 'none';
  else { ch.display = 'block'; ch.left = pct(L.cam.x, W); ch.top = pct(L.cam.y, H); ch.width = pct(L.cam.w, W); ch.height = pct(L.cam.h, H); ch.borderRadius = L.shape === 'circle' ? '50%' : '10%'; }
}

/* ================= desenho ================= */
function rrect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function drawImg(el, r, c, mirror) {
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  if (mirror) { ctx.translate(c.x * 2 + c.w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(el, c.x, c.y, c.w, c.h); ctx.restore();
}
function coverRect(r, aspect) { const sc = Math.max(r.w / aspect, r.h); const w = aspect * sc, h = sc; return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }; }
function drawCam(L) {
  const r = L.cam, ok = cam.readyState >= 2 && cam.videoWidth;
  ctx.save();
  if (L.shape === 'circle') { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2); ctx.clip(); }
  else if (L.shape === 'rect') { rrect(r.x, r.y, r.w, r.h, r.w * 0.1); ctx.clip(); }
  ctx.fillStyle = '#222'; ctx.fillRect(r.x, r.y, r.w, r.h);
  if (ok) drawImg(cam, r, camRect(r, cam.videoWidth / cam.videoHeight), S.mirror);
  else { ctx.fillStyle = '#777'; ctx.font = `600 ${Math.round(r.w * 0.06)}px -apple-system,sans-serif`; ctx.textAlign = 'center'; ctx.fillText('câmera desligada', r.x + r.w / 2, r.y + r.h / 2); }
  ctx.restore();
  if (L.shape !== 'full') {
    ctx.save(); ctx.lineWidth = Math.max(5, r.w * 0.025) + R.talking * r.w * 0.03; ctx.strokeStyle = R.talking > 0.2 ? '#ff3b30' : '#fff';
    if (L.shape === 'circle') { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2); } else rrect(r.x, r.y, r.w, r.h, r.w * 0.1);
    ctx.stroke(); ctx.restore();
  }
}
function drawBadge(v) {
  const fs = Math.round(Math.min(cv.width, cv.height) * 0.04);
  ctx.save(); ctx.font = `800 ${fs}px -apple-system,Segoe UI,Roboto,sans-serif`;
  const txt = '❚❚ PAUSEI PRA COMENTAR', tw = ctx.measureText(txt).width, pad = fs * 0.6, x = v.x + fs * 0.6, y = v.y + fs * 0.6;
  ctx.globalAlpha = 0.65 + 0.35 * Math.abs(Math.sin(performance.now() / 400));
  ctx.fillStyle = '#ff3b30'; rrect(x, y, tw + pad * 2, fs * 1.8, fs * 0.9); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + pad, y + fs * 0.92); ctx.restore();
}
function wrap(text, maxW) {
  const out = []; let cur = '';
  for (const w of text.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
function drawBubble(v) {
  const fs = Math.round(Math.min(cv.width, cv.height) * 0.05);
  ctx.save(); ctx.font = `800 ${fs}px -apple-system,Segoe UI,Roboto,sans-serif`;
  const lines = wrap(R.bubble, v.w * 0.78), lh = fs * 1.2;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs * 1.4, bh = lines.length * lh + fs * 0.9;
  const x = v.x + (v.w - bw) / 2, y = v.y + v.h * 0.1 + fs;
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = fs * 0.6; ctx.fillStyle = '#fff'; rrect(x, y, bw, bh, fs * 0.6); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + bw * 0.7, y + bh - 1); ctx.lineTo(x + bw * 0.78, y + bh + fs * 0.8); ctx.lineTo(x + bw * 0.6, y + bh - 1); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#111'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, x + bw / 2, y + fs * 0.45 + i * lh)); ctx.restore();
}
function drawParticles() {
  R.particles = R.particles.filter((p) => p.life > 0);
  for (const p of R.particles) {
    p.x += p.vx; p.y += p.vy; p.vy *= 0.985; p.life -= 0.012;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.font = `${p.s}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.e, 0, 0); ctx.restore();
  }
}
let talkHold = 0, lastYTVol = -1;
function audioTick() {
  let talking = false, rms = 0;
  if (analyser && micNode) {
    analyser.getByteTimeDomainData(micData);
    let sum = 0; for (let i = 0; i < micData.length; i++) { const d = (micData[i] - 128) / 128; sum += d * d; }
    rms = Math.sqrt(sum / micData.length); if (rms > 0.035) talkHold = performance.now() + 450; talking = performance.now() < talkHold;
  }
  R.talking += ((talking ? Math.min(1, rms * 8) : 0) - R.talking) * 0.25;
  const target = S.vol * (S.duck && talking ? 0.25 : 1);
  if (vidGain) vidGain.gain.setTargetAtTime(target, ac.currentTime, 0.08);
  if (isYT() && R.ytReady) { const v = Math.round(target * 100); if (v !== lastYTVol) { lastYTVol = v; try { R.yt.setVolume(v); } catch {} } }
}
function frame() {
  requestAnimationFrame(frame);
  audioTick();
  const W = cv.width, H = cv.height, L = layout(W, H), v = L.video;
  if (isYT()) ctx.clearRect(0, 0, W, H);
  else {
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
    if (R.source && vid.readyState >= 2 && vid.videoWidth) { ctx.fillStyle = '#000'; ctx.fillRect(v.x, v.y, v.w, v.h); drawImg(vid, v, contentRect(v, vid.videoWidth / vid.videoHeight, S.fill), false); }
  }
  drawCam(L);
  if (L.shape === 'full') { ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(0, L.line - 1, W, 2); }
  if (R.source && R.paused && S.badge && curTime() > 0.1) drawBadge(v);
  if (R.bubble) drawBubble(v);
  drawParticles();
  placeOverlays(L);
  const d = duration(), t = curTime();
  if (!seeking) { seekBar.value = d ? (t / d) * 1000 : 0; $('#tCur').textContent = fmt(t); }
  $('#tDur').textContent = fmt(d);
  const q = $('#qualityPill');
  q.textContent = R.recording ? '● REC ' + fmt((performance.now() - R.recStart) / 1000) : (isYT() ? 'YouTube ' : '720p·30 ') + (S.layout === 'pip169' ? '16:9' : '9:16');
  q.classList.toggle('rec', R.recording);
}

/* ================= gestos ================= */
function rel(e) { const r = box.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
// tocar no vídeo = pausar/play (modo arquivo)
let tap = null;
cv.addEventListener('pointerdown', (e) => { tap = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', (e) => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && R.source) togglePlay(); tap = null; });
// arrastar e pinçar a câmera
const camHit = $('#camHit'), ptrs = new Map(); let camDrag = null;
camHit.addEventListener('pointerdown', (e) => {
  camHit.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e));
  const pts = [...ptrs.values()];
  camDrag = pts.length === 1 ? { mode: 'move', p: pts[0], x: S.camX, y: S.camY, moved: false }
    : { mode: 'pinch', d: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), s: S.camSize };
});
camHit.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId) || !camDrag) return; ptrs.set(e.pointerId, rel(e)); const pts = [...ptrs.values()];
  if (camDrag.mode === 'pinch' && pts.length >= 2) {
    const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]); S.camSize = Math.max(0.18, Math.min(0.75, camDrag.s * d / camDrag.d));
  } else if (camDrag.mode === 'move') {
    const [x, y] = pts[0]; if (Math.hypot(x - camDrag.p[0], y - camDrag.p[1]) > 0.01) camDrag.moved = true;
    S.camX = Math.max(0, Math.min(1, camDrag.x + x - camDrag.p[0])); S.camY = Math.max(0, Math.min(1, camDrag.y + y - camDrag.p[1]));
  }
});
function camUp(e) {
  ptrs.delete(e.pointerId);
  if (camDrag && camDrag.mode === 'move' && !camDrag.moved && ptrs.size === 0 && R.source) togglePlay();
  if (ptrs.size === 0) { camDrag = null; save(); applyUI(); }
}
camHit.addEventListener('pointerup', camUp); camHit.addEventListener('pointercancel', camUp);
// ajustar divisão
const sp = $('#splitPill'); let spDrag = false;
sp.addEventListener('pointerdown', (e) => { spDrag = true; sp.setPointerCapture(e.pointerId); });
sp.addEventListener('pointermove', (e) => { if (!spDrag) return; const y = rel(e)[1]; S.split = Math.max(0.2, Math.min(0.8, S.camTop ? y : 1 - y)); });
sp.addEventListener('pointerup', () => { spDrag = false; save(); });
sp.addEventListener('click', () => {});

/* ================= modo AJUSTAR: arrastar = mover, pinçar = zoom ================= */
const adj = $('#adjHit'), aptrs = new Map(); let ag = null, lastTapT = 0;
function setAdjust(on) {
  document.body.classList.toggle('adjusting', on); $('#adjBtn').classList.toggle('on', on);
  if (on) { closeSheets(); toast('Arraste pra mover · Pince pra dar zoom · 2 toques = resetar', 3200); } else save();
}
$('#adjBtn').addEventListener('click', () => setAdjust(!document.body.classList.contains('adjusting')));
$('#adjDone').addEventListener('click', () => setAdjust(false));
function cpt(e) { const r = box.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; }
const inR = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
function agStart(keepTarget) {
  const pts = [...aptrs.values()], L = layout(cv.width, cv.height);
  const c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const d = pts.length > 1 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0;
  const target = keepTarget || (inR(pts[0], L.cam) ? 'cam' : 'video');
  ag = { target, c, d, L, snap: { ...S } };
}
adj.addEventListener('pointerdown', (e) => {
  adj.setPointerCapture(e.pointerId); aptrs.set(e.pointerId, cpt(e)); agStart(ag && ag.target);
  if (aptrs.size === 1) { // duplo toque reseta
    const now = performance.now();
    if (now - lastTapT < 300) {
      if (ag.target === 'cam') Object.assign(S, { camZoom: 1, camOffX: 0, camOffY: 0 }); else Object.assign(S, { zoom: 1, offX: 0, offY: 0 });
      toast('Resetado'); save(); applyUI(); agStart(ag.target);
    }
    lastTapT = now;
  }
});
adj.addEventListener('pointermove', (e) => {
  if (!aptrs.has(e.pointerId) || !ag) return; aptrs.set(e.pointerId, cpt(e));
  const pts = [...aptrs.values()], s0 = ag.snap, L = ag.L, W = cv.width, H = cv.height;
  const c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const dx = c[0] - ag.c[0], dy = c[1] - ag.c[1];
  const k = pts.length > 1 && ag.d > 0 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) / ag.d : 1;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  if (ag.target === 'video') {
    const r = L.video; S.zoom = cl(s0.zoom * k, 0.5, 5); S.offX = cl(s0.offX + dx / r.w, -1.5, 1.5); S.offY = cl(s0.offY + dy / r.h, -1.5, 1.5);
  } else if (L.shape === 'full') { // câmera na tela dividida: zoom/mover dentro da metade
    const r = L.cam; S.camZoom = cl(s0.camZoom * k, 1, 4); S.camOffX = cl(s0.camOffX + (S.mirror ? -dx : dx) / r.w, -1, 1); S.camOffY = cl(s0.camOffY + dy / r.h, -1, 1);
  } else { // câmera no canto: arrastar move a bolha, pinçar muda o tamanho
    S.camX = cl(s0.camX + dx / W, 0, 1); S.camY = cl(s0.camY + dy / H, 0, 1); S.camSize = cl(s0.camSize * k, 0.18, 0.8);
  }
});
function adjUp(e) {
  aptrs.delete(e.pointerId);
  if (aptrs.size) agStart(ag && ag.target); else { ag = null; save(); applyUI(); }
}
adj.addEventListener('pointerup', adjUp); adj.addEventListener('pointercancel', adjUp);

/* ================= gravação ================= */
let rec = null, chunks = [], recMime = '', lastBlob = null;
$('#recBtn').addEventListener('click', () => {
  if (R.recording) return stopRec();
  if (isYT()) return openSheet('#ytRecSheet');
  startRec();
});
$('#goClean').addEventListener('click', () => { closeSheets(); document.body.classList.add('clean'); toast('Modo limpo: toque no ✕ no canto pra sair', 3000); });
$('#cleanExit').addEventListener('click', () => document.body.classList.remove('clean'));
$('#recCamOnly').addEventListener('click', () => { closeSheets(); startRec(); });
function startRec() {
  if (!window.MediaRecorder || !cv.captureStream) return toast('Seu navegador não grava. Atualize o iOS.');
  ensureAudio();
  const vs = cv.captureStream(30);
  const stream = new MediaStream([...vs.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  recMime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) || '';
  try { rec = new MediaRecorder(stream, recMime ? { mimeType: recMime, videoBitsPerSecond: 6000000 } : {}); }
  catch (e) { return toast('Erro ao gravar: ' + e.message); }
  chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; rec.onstop = finishRec; rec.start(1000);
  R.recording = true; R.recStart = performance.now(); $('#recBtn').classList.add('on');
  toast(R.source ? 'Gravando! Dê play e reaja 🎙️' : 'Gravando sua câmera');
}
function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); R.recording = false; $('#recBtn').classList.remove('on'); }
function finishRec() {
  const type = (rec && rec.mimeType) || recMime || 'video/mp4';
  lastBlob = new Blob(chunks, { type }); const url = URL.createObjectURL(lastBlob), ext = type.includes('mp4') ? 'mp4' : 'webm';
  $('#resultVid').src = url; $('#dlBtn').href = url; $('#dlBtn').download = 'react-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext;
  $('#lastBtn').classList.remove('hidden'); $('#result').classList.remove('hidden');
}
$('#lastBtn').addEventListener('click', () => $('#result').classList.remove('hidden'));
$('#saveBtn').addEventListener('click', async () => {
  if (!lastBlob) return;
  // tipo "limpo" (sem codecs) — o iOS só oferece "Salvar Vídeo" (app Fotos) pra video/mp4 simples
  const base = lastBlob.type.split(';')[0] || 'video/mp4';
  const file = new File([lastBlob], $('#dlBtn').download, { type: base });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); toast('Se escolheu “Salvar Vídeo”, está no app Fotos ✅', 3500); }
    catch (e) { if (e.name !== 'AbortError') toast('Não abriu o compartilhar: ' + e.message); }
  } else { $('#dlBtn').click(); toast('Baixado em Arquivos › Downloads. Abra e toque em Compartilhar › Salvar Vídeo', 5000); }
});
$('#closeResult').addEventListener('click', () => { $('#result').classList.add('hidden'); $('#resultVid').pause(); });

/* ================= início ================= */
async function wake() { try { await navigator.wakeLock.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
applyUI(); setPaused(true); wake(); requestAnimationFrame(frame);
(async () => {
  try { await getCam(); }
  catch (e) { console.warn(e); toast('Permita câmera e microfone (Ajustes › Safari › Câmera/Microfone)', 5000); }
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
