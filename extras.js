/* Reagindo — extras: recorte de fundo, filtros, legenda ao vivo, faixa, tela final, histórico, pausa, fila. */
'use strict';

/* =================== CÂMERA PROCESSADA (fundo + filtros) ===================
   O recorte roda num Worker (fora da tela principal): a interface e a gravação nunca esperam por ele.
   A máscara é suavizada no tempo (não pisca) e nas bordas (sem serrilhado). Um "governador"
   baixa a qualidade sozinho se o aparelho pesar. */
const pc = document.createElement('canvas'), pg = pc.getContext('2d');
const small = document.createElement('canvas'), sg = small.getContext('2d');
const bgCv = document.createElement('canvas'), bgx = bgCv.getContext('2d');
const tiny = document.createElement('canvas'), tg = tiny.getContext('2d');
const maskCv = document.createElement('canvas'), mg2 = maskCv.getContext('2d');
const softCv = document.createElement('canvas'), sfx = softCv.getContext('2d');
const FILTER_OK = (() => { try { const c = document.createElement('canvas').getContext('2d'); if (!('filter' in c)) return false; c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; } catch { return false; } })();
let segMode = null, segLoading = false, segFail = false, maskReady = false, maskImg = null, prevM = null;
let worker = null, busy = false, busySince = 0, lastSend = 0, segCost = 40, mainSeg = null;
let bgImg = null;
try { const d = localStorage.getItem('reagindo-bg'); if (d) { bgImg = new Image(); bgImg.src = d; } } catch {}
// níveis de qualidade (o governador escolhe)
const QL = [{ cap: 960, every: 50 }, { cap: 720, every: 90 }, { cap: 480, every: 150 }];
let qLevel = 0;

function loadSeg() {
  if (segMode || segLoading || segFail) return; segLoading = true;
  toast('Preparando o recorte de fundo… (só na 1ª vez demora)', 3500);
  try {
    worker = new Worker('seg-worker.js?v=16');
    const giveUp = setTimeout(() => { if (!segMode) { try { worker.terminate(); } catch {} worker = null; startMainSeg(); } }, 30000);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(giveUp); segMode = 'worker'; segLoading = false; }
      else if (m.type === 'fail') { clearTimeout(giveUp); worker.terminate(); worker = null; startMainSeg(); }
      else if (m.type === 'mask') { busy = false; segCost = segCost * 0.7 + m.cost * 0.3; applyMask(m.w, m.h, m.a); if (!applyMask.shown) { applyMask.shown = 1; toast('Recorte de fundo pronto ✂️'); } }
      else { busy = false; }
    };
    worker.onerror = () => { clearTimeout(giveUp); try { worker.terminate(); } catch {} worker = null; if (!segMode) startMainSeg(); };
    worker.postMessage({ type: 'init' });
  } catch { startMainSeg(); }
}
// plano B (aparelho sem worker): roda na tela principal, mais devagar
async function startMainSeg() {
  try {
    const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const { FilesetResolver, ImageSegmenter } = await import(V + '/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(V + '/wasm');
    const o = (d) => ({ baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', delegate: d },
      runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    try { mainSeg = await ImageSegmenter.createFromOptions(fs, o('GPU')); } catch { mainSeg = await ImageSegmenter.createFromOptions(fs, o('CPU')); }
    segMode = 'main'; qLevel = Math.max(qLevel, 1);
  } catch (e) { console.warn(e); segFail = true; toast('Recorte de fundo não funcionou neste aparelho', 4000); }
  segLoading = false;
}
function segSize() { const vw = cam.videoWidth, vh = cam.videoHeight, k = 256 / Math.max(vw, vh); return [Math.max(16, Math.round(vw * k)), Math.max(16, Math.round(vh * k))]; }
function feedSeg() {
  const now = performance.now(), every = Math.max(QL[qLevel].every, segMode === 'main' ? 120 : segCost * 1.1);
  if (now - lastSend < every) return;
  if (segMode === 'worker') {
    if (busy) { if (now - busySince > 20000) busy = false; return; }
    busy = true; busySince = now; lastSend = now;
    const [w, h] = segSize();
    createImageBitmap(cam, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      .then((bmp) => worker.postMessage({ type: 'frame', bmp, ts: now }, [bmp]))
      .catch(() => { busy = false; });
  } else if (segMode === 'main' && mainSeg) {
    lastSend = now; const [w, h] = segSize(); small.width = w; small.height = h; sg.drawImage(cam, 0, 0, w, h);
    try {
      mainSeg.segmentForVideo(small, now, (res) => {
        const mk = res.confidenceMasks && res.confidenceMasks[0]; if (!mk) return;
        const f = mk.getAsFloat32Array(), a = new Uint8ClampedArray(f.length); for (let i = 0; i < f.length; i++) a[i] = f[i] * 255;
        applyMask(mk.width, mk.height, a);
      });
    } catch (e) { console.warn(e); }
  }
}
// suaviza no tempo (não pisca) e cria borda macia
function applyMask(w, h, a) {
  if (maskCv.width !== w || maskCv.height !== h || !maskImg) { maskCv.width = w; maskCv.height = h; maskImg = mg2.createImageData(w, h); prevM = new Float32Array(w * h); }
  const d = maskImg.data, first = !maskReady;
  for (let i = 0, j = 3; i < a.length; i++, j += 4) {
    const v = a[i] / 255, s = first ? v : prevM[i] * 0.45 + v * 0.55; prevM[i] = s;
    const t = Math.min(1, Math.max(0, (s - 0.3) / 0.4)); d[j] = t * t * (3 - 2 * t) * 255; // smoothstep
  }
  mg2.putImageData(maskImg, 0, 0);
  softCv.width = w * 2; softCv.height = h * 2;
  if (FILTER_OK) sfx.filter = 'blur(1.6px)';
  sfx.imageSmoothingEnabled = true; sfx.imageSmoothingQuality = 'high'; sfx.drawImage(maskCv, 0, 0, softCv.width, softCv.height);
  if (FILTER_OK) sfx.filter = 'none';
  maskReady = true;
}
// fundo desfocado suave SEM você dentro (senão aparece uma "aura" escura em volta da cabeça)
const bgOnly = document.createElement('canvas'), bo = bgOnly.getContext('2d');
function blurPass(dst, dctx, src, radius, alpha = 1) {
  dctx.globalAlpha = alpha;
  if (FILTER_OK) { dctx.filter = `blur(${radius}px)`; dctx.drawImage(src, 0, 0, dst.width, dst.height); dctx.filter = 'none'; }
  else { // sem filtro no navegador: desce e sobe de tamanho (vira um desfoque liso)
    const f = Math.max(2, radius / 2);
    tiny.width = Math.max(2, Math.round(dst.width / f)); tiny.height = Math.max(2, Math.round(dst.height / f));
    tg.clearRect(0, 0, tiny.width, tiny.height); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = 'high';
    tg.drawImage(src, 0, 0, tiny.width, tiny.height); dctx.drawImage(tiny, 0, 0, dst.width, dst.height);
  }
  dctx.globalAlpha = 1;
}
let lastBgT = 0;
function blurredBg(W, H) {
  const bw = Math.max(16, Math.round(W / 4)), bh = Math.max(16, Math.round(H / 4)), R = Math.max(3, bw * 0.03);
  // fundo borrado muda devagar: reaproveita o pronto e só recalcula algumas vezes por segundo
  const now = performance.now();
  if (bgCv.width === bw && bgCv.height === bh && now - lastBgT < [110, 220, 400][qLevel]) return bgCv;
  lastBgT = now;
  if (bgCv.width !== bw || bgCv.height !== bh) { bgCv.width = bw; bgCv.height = bh; bgOnly.width = bw; bgOnly.height = bh; }
  bgx.imageSmoothingEnabled = bo.imageSmoothingEnabled = true; bgx.imageSmoothingQuality = bo.imageSmoothingQuality = 'high';
  // 1) só o fundo: câmera menos você (máscara um pouco maior pra não sobrar borda sua)
  bo.globalCompositeOperation = 'source-over'; bo.clearRect(0, 0, bw, bh); bo.drawImage(cam, 0, 0, bw, bh);
  if (maskReady) { bo.globalCompositeOperation = 'destination-out'; const g = 0.06; bo.drawImage(softCv, -bw * g / 2, -bh * g / 2, bw * (1 + g), bh * (1 + g)); bo.globalCompositeOperation = 'source-over'; }
  // 2) base: cor média da cena (cobre o buraco onde você estava)
  tiny.width = 1; tiny.height = 1; tg.drawImage(cam, 0, 0, 1, 1); bgx.drawImage(tiny, 0, 0, bw, bh);
  // 3) desfoque largo (preenche o buraco com o fundo de volta) + desfoque normal por cima
  blurPass(bgCv, bgx, bgOnly, R * 4); blurPass(bgCv, bgx, bgOnly, R * 4); blurPass(bgCv, bgx, bgOnly, R);
  return bgCv;
}
function camSource(r) {
  if (!(cam.readyState >= 2 && cam.videoWidth)) return cam;
  const needSeg = S.camBg !== 'normal', needF = S.light > 0 || S.smooth > 0 || S.bw;
  if (!needSeg && !needF) return cam;
  // só processa no tamanho que aparece na tela (nunca mais que isso)
  const asp = cam.videoWidth / cam.videoHeight, shown = r ? Math.max(r.w, r.h * asp) * (S.camZoom || 1) * 1.1 : 960;
  const W0 = Math.min(cam.videoWidth, QL[qLevel].cap, Math.max(240, shown)), k = W0 / cam.videoWidth;
  const W = Math.round(cam.videoWidth * k), H = Math.round(cam.videoHeight * k);
  if (pc.width !== W || pc.height !== H) { pc.width = W; pc.height = H; }
  pg.globalCompositeOperation = 'source-over'; pg.globalAlpha = 1; pg.clearRect(0, 0, W, H);
  pg.imageSmoothingEnabled = true; pg.imageSmoothingQuality = 'high';
  pg.drawImage(cam, 0, 0, W, H);
  if (S.smooth > 0) {
    small.width = Math.round(W / 5); small.height = Math.round(H / 5);
    if (FILTER_OK) sg.filter = 'blur(1px)'; sg.drawImage(cam, 0, 0, small.width, small.height); if (FILTER_OK) sg.filter = 'none';
    pg.globalAlpha = S.smooth * 0.5; pg.drawImage(small, 0, 0, W, H); pg.globalAlpha = 1;
  }
  if (S.light > 0) { pg.globalCompositeOperation = 'screen'; pg.fillStyle = `rgba(255,236,220,${S.light * 0.55})`; pg.fillRect(0, 0, W, H); }
  if (S.bw) { pg.globalCompositeOperation = 'saturation'; pg.fillStyle = 'hsl(0,0%,50%)'; pg.fillRect(0, 0, W, H); }
  pg.globalCompositeOperation = 'source-over';
  if (needSeg) {
    loadSeg(); if (segMode) feedSeg();
    if (maskReady) {
      pg.globalCompositeOperation = 'destination-in'; pg.drawImage(softCv, 0, 0, W, H);
      pg.globalCompositeOperation = 'destination-over';
      if (S.camBg === 'blur') pg.drawImage(blurredBg(W, H), 0, 0, W, H);
      else if (S.camBg === 'color') { pg.fillStyle = S.bgColor; pg.fillRect(0, 0, W, H); }
      else if (S.camBg === 'image' && bgImg && bgImg.complete && bgImg.naturalWidth) {
        const a = bgImg.naturalWidth / bgImg.naturalHeight, sc = Math.max(W / a, H), iw = a * sc, ih = sc;
        pg.save(); if (S.mirror) { pg.translate(W, 0); pg.scale(-1, 1); } pg.drawImage(bgImg, (W - iw) / 2, (H - ih) / 2, iw, ih); pg.restore();
      }
      pg.globalCompositeOperation = 'source-over';
    } else if (S.camBg === 'blur') { // enquanto o recorte prepara: desfoca tudo de leve (sem travar)
      pg.globalAlpha = 0.6; pg.drawImage(blurredBg(W, H), 0, 0, W, H); pg.globalAlpha = 1;
    }
  }
  return pc;
}
window.camSource = camSource;
window.camTransparent = () => S.camBg === 'none' && maskReady;

/* governador: se a tela começar a pesar, baixa a qualidade do recorte sozinho (e sobe de novo quando aliviar) */
(function governor() {
  let last = performance.now(), ema = 16, hi = 0, lo = 0, warned = false; const vq = { t: 0, tot: 0, drop: 0, rate: 0 };
  (function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(200, now - last); last = now; ema = ema * 0.9 + dt * 0.1;
    // também vigia o vídeo da galeria: se ele estiver perdendo quadros, é sinal de aparelho apertado
    if (vid.getVideoPlaybackQuality && !vid.paused && R.source && !isYT() && now - vq.t > 1000) {
      const q = vid.getVideoPlaybackQuality(), dec = q.totalVideoFrames - vq.tot, drop = q.droppedVideoFrames - vq.drop;
      vq.rate = dec > 5 ? drop / dec : 0; vq.t = now; vq.tot = q.totalVideoFrames; vq.drop = q.droppedVideoFrames;
    } else if (vid.paused) vq.rate = 0;
    const active = S.camBg !== 'normal' || S.light > 0 || S.smooth > 0 || (R.source && !R.paused && !isYT());
    if (!active || document.hidden) { hi = lo = 0; return; }
    if (ema > 40 || vq.rate > 0.15) { hi += dt; lo = 0; } else if (ema < 22 && vq.rate < 0.03) { lo += dt; hi = 0; } else { hi = lo = 0; }
    if (hi > 1500 && qLevel < QL.length - 1) { qLevel++; hi = 0; if (!warned) { warned = true; toast('Ajustei a qualidade pra não travar ⚡'); } }
    if (lo > 6000 && qLevel > (segMode === 'main' ? 1 : 0)) { qLevel--; lo = 0; }
    window.perfLevel = qLevel;
  })(last);
})();
window.segStats = () => ({ segMode, qLevel, segCost: Math.round(segCost), maskReady, FILTER_OK });

// UI do fundo
$$('#bgSeg button').forEach((b) => b.addEventListener('click', () => {
  S.camBg = b.dataset.bg; if (S.camBg === 'none' && S.layout !== 'split') S.camShape = 'free';
  save(); applyUI(); syncExtras();
  if (S.camBg === 'image' && !bgImg) $('#bgFile').click();
}));
$('#bgColor').addEventListener('input', (e) => { S.bgColor = e.target.value; save(); });
$('#bgPick').addEventListener('click', () => $('#bgFile').click());
$('#bgFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const img = new Image(); img.onload = () => {
    const c = document.createElement('canvas'), k = Math.min(1, 1280 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.85); bgImg = new Image(); bgImg.src = url;
    try { localStorage.setItem('reagindo-bg', url); } catch {}
    S.camBg = 'image'; save(); syncExtras(); toast('Fundo trocado 🖼️');
  };
  img.src = URL.createObjectURL(f);
});
['light', 'smooth'].forEach((k) => $('#' + k).addEventListener('input', (e) => { S[k] = +e.target.value; save(); }));
$('#bw').addEventListener('change', (e) => { S.bw = e.target.checked; save(); });
$('#mirrorT').addEventListener('change', (e) => { S.mirror = e.target.checked; save(); });
$$('#resSeg button').forEach((b) => b.addEventListener('click', async () => {
  if (R.recording) return toast('Pare a gravação pra trocar a qualidade');
  S.res = b.dataset.res; save(); syncExtras(); applyUI();
  if (S.res === '4k') toast('4K pesa: em iPhone mais antigo pode travar ou esquentar', 4000);
  try { await getCam(); } catch {}
}));

/* =================== LEGENDA AO VIVO =================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr = null, capFinal = '', capInterim = '', capT = 0;
function capStart() {
  if (!SR) { toast('Legenda ao vivo não é suportada neste navegador', 3500); S.captions = false; syncExtras(); return; }
  if (sr) return;
  sr = new SR(); sr.lang = 'pt-BR'; sr.continuous = true; sr.interimResults = true;
  sr.onresult = (e) => {
    let fin = '', int = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else int += t; }
    if (fin) capFinal = (capFinal + ' ' + fin).trim().split(/\s+/).slice(-14).join(' ');
    capInterim = int; capT = performance.now();
  };
  sr.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Permita o reconhecimento de fala nos Ajustes do iPhone', 4000); S.captions = false; syncExtras(); } };
  sr.onend = () => { sr = null; if (S.captions) setTimeout(capStart, 250); };
  try { sr.start(); } catch { sr = null; }
}
function capStop() { S.captions = false; if (sr) { try { sr.stop(); } catch {} sr = null; } capFinal = capInterim = ''; }
$('#ccBtn').addEventListener('click', () => {
  if (S.captions) { capStop(); toast('Legenda desligada'); } else { S.captions = true; capStart(); toast('Legenda ao vivo ligada (beta) 💬'); }
  save(); syncExtras();
});
function drawCaptions(L) {
  if (!S.captions) return;
  if (performance.now() - capT > 3000) { capFinal = ''; capInterim = ''; }
  const words = (capFinal + ' ' + capInterim).trim().split(/\s+/).filter(Boolean).slice(-9); if (!words.length) return;
  const W = cv.width, H = cv.height, fs = Math.round(Math.min(W, H) * 0.052);
  ctx.save(); ctx.font = `900 ${fs}px -apple-system,"Arial Black",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const lines = wrap(words.join(' ').toUpperCase(), W * 0.86).slice(-2), lh = fs * 1.18;
  const r = L.shape === 'full' ? L.cam : L.video, y0 = r.y + r.h * 0.82 - (lines.length - 1) * lh;
  lines.forEach((l, i) => { const y = y0 + i * lh; ctx.lineWidth = fs * 0.22; ctx.strokeStyle = '#000'; ctx.strokeText(l, W / 2, y); ctx.fillStyle = i === lines.length - 1 ? '#ffd60a' : '#fff'; ctx.fillText(l, W / 2, y); });
  ctx.restore();
}

/* =================== FAIXA (estilo TV) + TELA FINAL =================== */
['tickerTag', 'tickerText', 'endQ'].forEach((k) => $('#' + k).addEventListener('input', (e) => { S[k] = e.target.value; save(); }));
$('#tickerOn').addEventListener('change', (e) => { S.tickerOn = e.target.checked; save(); syncExtras(); });
$('#tickerBtn').addEventListener('click', () => { if (!S.tickerText) { openSheet('#settingsSheet'); $('#tickerText').focus(); toast('Escreva o texto da faixa'); } S.tickerOn = !S.tickerOn; save(); syncExtras(); });
let endAt = 0;
$('#endBtn').addEventListener('click', () => { endAt = performance.now(); });
$('#endNow').addEventListener('click', () => { closeSheets(); endAt = performance.now(); });
function drawTicker(v) {
  const t = (S.tickerText || '').trim(); if (!S.tickerOn || !t) return;
  const fs = Math.round(Math.min(cv.width, cv.height) * 0.04), h = fs * 2.1, y = v.y + v.h - h - fs * 1.6, x = v.x + fs * 0.6, w = v.w - fs * 1.2;
  const tag = (S.tickerTag || 'LANCE').toUpperCase();
  ctx.save(); ctx.font = `900 ${fs}px -apple-system,"Arial Black",sans-serif`; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(tag).width + fs * 1.2;
  ctx.fillStyle = 'rgba(10,10,14,.88)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e10600'; ctx.fillRect(x, y, tw, h);
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(x, y + h - fs * 0.18, w, fs * 0.18);
  ctx.fillStyle = '#fff'; ctx.fillText(tag, x + fs * 0.6, y + h / 2);
  ctx.font = `800 ${fs}px -apple-system,sans-serif`; ctx.save(); ctx.beginPath(); ctx.rect(x + tw, y, w - tw, h); ctx.clip();
  const txt = t.toUpperCase(), ttw = ctx.measureText(txt).width, room = w - tw - fs * 1.2;
  const off = ttw > room ? ((performance.now() / 1000 * fs * 2.2) % (ttw + room)) : 0; // rola se não couber
  ctx.fillText(txt, x + tw + fs * 0.6 + (ttw > room ? room - off : 0), y + h / 2); ctx.restore(); ctx.restore();
}
function drawEnd() {
  if (!endAt) return; const t = (performance.now() - endAt) / 1000; if (t > 6) { endAt = 0; return; }
  const W = cv.width, H = cv.height, m = Math.min(W, H), a = Math.min(1, t / 0.4) * (t > 5.5 ? (6 - t) / 0.5 : 1);
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const q = (S.endQ || 'E aí, o que você achou?').toUpperCase(), fs = m * 0.075;
  ctx.font = `900 ${fs}px -apple-system,"Arial Black",sans-serif`;
  const lines = wrap(q, W * 0.84); lines.forEach((l, i) => { ctx.lineWidth = fs * 0.18; ctx.strokeStyle = '#000'; ctx.strokeText(l, W / 2, H * 0.36 + i * fs * 1.15); ctx.fillStyle = '#fff'; ctx.fillText(l, W / 2, H * 0.36 + i * fs * 1.15); });
  const pulse = 1 + 0.06 * Math.sin(t * 7), bw = m * 0.62, bh = m * 0.12;
  const btn = (y, bg, fg, txt) => { ctx.save(); ctx.translate(W / 2, y); ctx.scale(pulse, pulse); ctx.fillStyle = bg; rrect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = fg; ctx.font = `900 ${m * 0.05}px -apple-system,sans-serif`; ctx.fillText(txt, 0, 2); ctx.restore(); };
  btn(H * 0.6, '#fff', '#000', 'COMENTA AÍ 👇'); btn(H * 0.6 + bh * 1.35, '#ff0000', '#fff', '🔔 SE INSCREVE');
  ctx.restore();
}

/* =================== PAUSAR GRAVAÇÃO =================== */
let recPausedAt = 0, recPausedTotal = 0;
$('#pauseRec').addEventListener('click', () => {
  if (!R.recording || !rec) return;
  if (rec.state === 'recording') { rec.pause(); recPausedAt = performance.now(); pauseMedia(); $('#pauseRec').classList.add('on'); toast('Gravação pausada ⏸ Toque de novo pra continuar'); }
  else if (rec.state === 'paused') { rec.resume(); recPausedTotal += performance.now() - recPausedAt; recPausedAt = 0; $('#pauseRec').classList.remove('on'); toast('Gravando de novo ●'); }
});
window.recElapsed = () => (performance.now() - R.recStart - recPausedTotal - (recPausedAt ? performance.now() - recPausedAt : 0)) / 1000;
window.onRecStart = () => { recPausedAt = 0; recPausedTotal = 0; $('#pauseRec').classList.remove('on'); };

/* =================== HISTÓRICO DE GRAVAÇÕES =================== */
function hOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('reagindo', 2);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('sons')) db.createObjectStore('sons', { keyPath: 'id' }); if (!db.objectStoreNames.contains('gravacoes')) db.createObjectStore('gravacoes', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function hAll() { try { const db = await hOpen(); return await new Promise((res) => { const q = db.transaction('gravacoes').objectStore('gravacoes').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch { return []; } }
async function hTx(fn) { const db = await hOpen(); return new Promise((res, rej) => { const t = db.transaction('gravacoes', 'readwrite'); fn(t.objectStore('gravacoes')); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
window.saveHistory = async (blob, label) => {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  try { await hTx((st) => st.put({ id: 'g' + Date.now(), blob, label, date: Date.now(), size: blob.size })); }
  catch (e) { console.warn(e); toast('Não coube no histórico (memória cheia)'); }
};
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
async function renderHistory() {
  const list = $('#histList'); list.innerHTML = '';
  const items = (await hAll()).sort((a, b) => b.date - a.date);
  if (!items.length) list.innerHTML = '<p class="hint">Nenhuma gravação ainda. Tudo que você gravar fica salvo aqui.</p>';
  for (const g of items) {
    const row = document.createElement('div'); row.className = 'hrow';
    const d = new Date(g.date);
    row.innerHTML = `<div><b></b><small></small></div><button data-a="ver">▶</button><button data-a="edit">✂️</button><button data-a="del">🗑</button>`;
    row.querySelector('b').textContent = g.label || 'React';
    row.querySelector('small').textContent = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + mb(g.size);
    row.querySelector('[data-a=ver]').addEventListener('click', () => showBlob(g.blob));
    row.querySelector('[data-a=edit]').addEventListener('click', () => { closeSheets(); openEditor(g.blob); });
    row.querySelector('[data-a=del]').addEventListener('click', async () => { if (!confirm('Apagar essa gravação do app? (não apaga do app Fotos)')) return; await hTx((st) => st.delete(g.id)); renderHistory(); });
    list.appendChild(row);
  }
  try { const e = await navigator.storage.estimate(); $('#histUse').textContent = `Usando ${mb(e.usage || 0)} do iPhone`; } catch {}
}
function showBlob(blob) {
  lastBlob = blob; const url = URL.createObjectURL(blob), ext = (blob.type || '').includes('webm') ? 'webm' : 'mp4';
  $('#resultVid').src = url; $('#dlBtn').href = url; $('#dlBtn').download = 'react-' + Date.now() + '.' + ext;
  closeSheets(); $('#result').classList.remove('hidden');
}
['#histBtn', '#histBtn2'].forEach((id) => $(id).addEventListener('click', () => { $('#result').classList.add('hidden'); openSheet('#histSheet'); renderHistory(); }));

/* =================== FILA DE VÍDEOS =================== */
const Q = { files: [], i: 0 };
$('#fileMulti').addEventListener('change', (e) => {
  const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return;
  Q.files = fs; Q.i = 0; qLoad(); toast(fs.length > 1 ? `Fila com ${fs.length} vídeos 🎞️` : 'Vídeo carregado');
});
function qLoad() { const f = Q.files[Q.i]; if (!f) return; setSource({ type: 'file', url: URL.createObjectURL(f), name: f.name }); syncExtras(); }
function qGo(d, play) { if (Q.files.length < 2) return; const n = Q.i + d; if (n < 0 || n >= Q.files.length) return toast(d > 0 ? 'Fim da fila' : 'Início da fila'); Q.i = n; qLoad(); if (play) setTimeout(playMedia, 300); }
$('#qPrev').addEventListener('click', () => qGo(-1, !R.paused));
$('#qNext').addEventListener('click', () => qGo(1, !R.paused));
vid.addEventListener('ended', () => { if (S.autoNext && Q.files.length > 1 && Q.i < Q.files.length - 1) qGo(1, true); });
$('#autoNext').addEventListener('change', (e) => { S.autoNext = e.target.checked; save(); });

/* =================== sincroniza UI =================== */
function syncExtras() {
  $$('#bgSeg button').forEach((b) => b.classList.toggle('on', b.dataset.bg === S.camBg));
  $$('#resSeg button').forEach((b) => b.classList.toggle('on', b.dataset.res === S.res));
  $('#bgColorRow').classList.toggle('hidden', S.camBg !== 'color'); $('#bgPickRow').classList.toggle('hidden', S.camBg !== 'image');
  $('#bgColor').value = S.bgColor; $('#light').value = S.light; $('#smooth').value = S.smooth; $('#bw').checked = S.bw; $('#mirrorT').checked = S.mirror;
  $('#ccBtn').classList.toggle('on', !!S.captions);
  $('#tickerOn').checked = S.tickerOn; $('#tickerBtn').classList.toggle('on', S.tickerOn);
  ['tickerTag', 'tickerText', 'endQ'].forEach((k) => { if (document.activeElement !== $('#' + k)) $('#' + k).value = S[k] || ''; });
  $('#autoNext').checked = S.autoNext;
  $('#qPrev').classList.toggle('hidden', Q.files.length < 2); $('#qNext').classList.toggle('hidden', Q.files.length < 2);
  $('#qInfo').textContent = Q.files.length > 1 ? `${Q.i + 1}/${Q.files.length}` : ''; $('#qInfo').classList.toggle('hidden', Q.files.length < 2);
}
window.extrasDraw = (L) => { drawTicker(L.video); drawCaptions(L); drawEnd(); };
syncExtras();
if (S.captions) { S.captions = false; save(); syncExtras(); } // legenda começa desligada (precisa de toque)
