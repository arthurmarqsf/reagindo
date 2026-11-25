/* Reagindo — extras: recorte de fundo, filtros, legenda ao vivo, faixa, tela final, histórico, pausa, fila. */
'use strict';

/* =================== CÂMERA PROCESSADA (fundo + filtros) =================== */
const pc = document.createElement('canvas'), pg = pc.getContext('2d');
const small = document.createElement('canvas'), sg = small.getContext('2d');
const maskCv = document.createElement('canvas'), mg2 = maskCv.getContext('2d');
let seg = null, segLoading = false, segFail = false, lastSegT = 0, maskReady = false, maskImg = null;
let bgImg = null;
try { const d = localStorage.getItem('reagindo-bg'); if (d) { bgImg = new Image(); bgImg.src = d; } } catch {}

async function loadSeg() {
  if (seg || segLoading || segFail) return; segLoading = true;
  toast('Carregando recorte de fundo… (só na 1ª vez demora)', 3500);
  try {
    const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const { FilesetResolver, ImageSegmenter } = await import(V + '/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(V + '/wasm');
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', delegate },
      runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    try { seg = await ImageSegmenter.createFromOptions(fs, opts('GPU')); } catch { seg = await ImageSegmenter.createFromOptions(fs, opts('CPU')); }
    toast('Recorte de fundo pronto ✂️');
  } catch (e) { console.warn(e); segFail = true; toast('Recorte de fundo não funcionou neste aparelho', 4000); }
  segLoading = false;
}
function runSeg() {
  const now = performance.now(); if (!seg || now - lastSegT < 45) return; lastSegT = now;
  try {
    seg.segmentForVideo(cam, now, (res) => {
      const m = res.confidenceMasks && res.confidenceMasks[0]; if (!m) return;
      const w = m.width, h = m.height, f = m.getAsFloat32Array();
      if (maskCv.width !== w || maskCv.height !== h) { maskCv.width = w; maskCv.height = h; maskImg = mg2.createImageData(w, h); }
      const d = maskImg.data;
      for (let i = 0, j = 3; i < f.length; i++, j += 4) { const a = f[i]; d[j] = a < 0.25 ? 0 : a > 0.75 ? 255 : (a - 0.25) * 510; }
      mg2.putImageData(maskImg, 0, 0); maskReady = true;
      res.close && res.close();
    });
  } catch (e) { console.warn(e); }
}
function camSource() {
  if (!(cam.readyState >= 2 && cam.videoWidth)) return cam;
  const needSeg = S.camBg !== 'normal', needF = S.light > 0 || S.smooth > 0 || S.bw;
  if (!needSeg && !needF) return cam;
  const cap = S.res === '4k' ? 1920 : 1280, k = Math.min(1, cap / cam.videoWidth);
  const W = Math.round(cam.videoWidth * k), H = Math.round(cam.videoHeight * k);
  if (pc.width !== W || pc.height !== H) { pc.width = W; pc.height = H; }
  pg.globalCompositeOperation = 'source-over'; pg.globalAlpha = 1; pg.clearRect(0, 0, W, H);
  pg.drawImage(cam, 0, 0, W, H);
  // filtros (antes do recorte, só na pessoa)
  if (S.smooth > 0) { small.width = Math.round(W / 6); small.height = Math.round(H / 6); sg.drawImage(cam, 0, 0, small.width, small.height); pg.globalAlpha = S.smooth * 0.55; pg.drawImage(small, 0, 0, W, H); pg.globalAlpha = 1; }
  if (S.light > 0) { pg.globalCompositeOperation = 'screen'; pg.fillStyle = `rgba(255,236,220,${S.light * 0.55})`; pg.fillRect(0, 0, W, H); }
  if (S.bw) { pg.globalCompositeOperation = 'saturation'; pg.fillStyle = 'hsl(0,0%,50%)'; pg.fillRect(0, 0, W, H); }
  pg.globalCompositeOperation = 'source-over';
  if (needSeg) {
    loadSeg(); runSeg();
    if (seg && maskReady) {
      pg.globalCompositeOperation = 'destination-in'; pg.drawImage(maskCv, 0, 0, W, H);
      pg.globalCompositeOperation = 'destination-over';
      if (S.camBg === 'blur') { small.width = Math.max(8, Math.round(W / 24)); small.height = Math.max(8, Math.round(H / 24)); sg.drawImage(cam, 0, 0, small.width, small.height); pg.drawImage(small, 0, 0, W, H); }
      else if (S.camBg === 'color') { pg.fillStyle = S.bgColor; pg.fillRect(0, 0, W, H); }
      else if (S.camBg === 'image' && bgImg && bgImg.complete && bgImg.naturalWidth) {
        const a = bgImg.naturalWidth / bgImg.naturalHeight, sc = Math.max(W / a, H), iw = a * sc, ih = sc;
        // a câmera é espelhada depois; espelha a foto aqui pra ela sair do jeito certo
        pg.save(); if (S.mirror) { pg.translate(W, 0); pg.scale(-1, 1); } pg.drawImage(bgImg, (W - iw) / 2, (H - ih) / 2, iw, ih); pg.restore();
      }
      pg.globalCompositeOperation = 'source-over';
    }
  }
  return pc;
}
window.camSource = camSource;
// precisa de fundo transparente? (desenha sem caixa atrás da câmera)
window.camTransparent = () => S.camBg === 'none' && !!seg && maskReady;

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
