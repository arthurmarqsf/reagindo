/* Reagindo — editor depois de gravar: cortar, capa com título, música de fundo, exportar. */
'use strict';
const edVid = $('#edVid'), edBar = $('#edBar');
const E = { blob: null, url: '', dur: 0, start: 0, end: 0, cuts: [], cutA: null,
  coverT: null, coverCv: null, title: '', coverInVideo: true, music: null, musicName: '', musicVol: 0.25, duck: true, busy: false };

/* ---------- abrir / fechar ---------- */
function openEditor(blob) {
  if (!blob) return toast('Nada pra editar');
  if (E.url) URL.revokeObjectURL(E.url);
  Object.assign(E, { blob, url: URL.createObjectURL(blob), cuts: [], cutA: null, coverT: null, coverCv: null, start: 0, end: 0 });
  edVid.src = E.url; edVid.load();
  $('#result').classList.add('hidden'); closeSheets();
  $('#editor').classList.remove('hidden'); edTab('cut'); edRender();
}
function closeEditor() { if (E.busy) return; edVid.pause(); $('#editor').classList.add('hidden'); }
$('#editBtn').addEventListener('click', () => openEditor(lastBlob));
$('#edClose').addEventListener('click', closeEditor);
$('#edFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openEditor(f); });
edVid.addEventListener('loadedmetadata', () => {
  E.dur = isFinite(edVid.duration) ? edVid.duration : 0;
  if (!E.dur) { // MediaRecorder às vezes gera vídeo sem duração: força o navegador a descobrir
    edVid.currentTime = 1e7;
    edVid.addEventListener('timeupdate', function fix() { edVid.removeEventListener('timeupdate', fix); E.dur = edVid.duration; E.end = E.dur; edVid.currentTime = 0; edRender(); });
  }
  E.end = E.dur; edRender();
});

/* ---------- abas ---------- */
function edTab(t) { $$('#edTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); $$('.edpane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t)); }
$$('#edTabs button').forEach((b) => b.addEventListener('click', () => edTab(b.dataset.tab)));

/* ---------- reprodução / linha do tempo ---------- */
const fmt2 = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); };
$('#edPlay').addEventListener('click', () => { ensureAudio(); hookEdAudio(); edVid.paused ? edVid.play() : edVid.pause(); });
edVid.addEventListener('play', () => { $('#edPlay').textContent = '❚❚'; });
edVid.addEventListener('pause', () => { $('#edPlay').textContent = '▶'; });
$('#edBack').addEventListener('click', () => { edVid.currentTime = Math.max(0, edVid.currentTime - 0.5); });
$('#edFwd').addEventListener('click', () => { edVid.currentTime = Math.min(E.dur, edVid.currentTime + 0.5); });
edBar.addEventListener('pointerdown', (e) => { edBar.setPointerCapture(e.pointerId); scrub(e); edBar.onpointermove = scrub; });
edBar.addEventListener('pointerup', () => { edBar.onpointermove = null; });
function scrub(e) { const r = edBar.getBoundingClientRect(); edVid.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * E.dur; }
// na prévia, pula os trechos cortados
edVid.addEventListener('timeupdate', () => {
  if (E.busy || edVid.paused) return;
  const t = edVid.currentTime;
  if (t < E.start - 0.05) edVid.currentTime = E.start;
  else if (t >= E.end) { edVid.pause(); edVid.currentTime = E.end; }
  else for (const c of E.cuts) if (t >= c[0] && t < c[1] - 0.05) { edVid.currentTime = c[1]; break; }
});
(function edLoop() {
  requestAnimationFrame(edLoop);
  if ($('#editor').classList.contains('hidden') || !E.dur) return;
  const p = (x) => (x / E.dur * 100) + '%';
  $('#edHead').style.left = p(edVid.currentTime);
  $('#edTime').textContent = fmt2(edVid.currentTime) + ' / ' + fmt2(keepLen()) + ' final';
  edMusicDuck();
})();
function edRender() {
  if (!E.dur) return;
  const p = (x) => (x / E.dur * 100) + '%', segs = $('#edSegs'); segs.innerHTML = '';
  const add = (a, b, cls) => { const d = document.createElement('div'); d.className = cls; d.style.left = p(a); d.style.width = p(b - a); segs.appendChild(d); };
  if (E.start > 0) add(0, E.start, 'trim');
  if (E.end < E.dur) add(E.end, E.dur, 'trim');
  E.cuts.forEach((c) => add(c[0], c[1], 'cut'));
  if (E.cutA != null) add(E.cutA, Math.max(E.cutA, edVid.currentTime), 'cut pending');
  const ol = $('#edCuts'); ol.innerHTML = '';
  E.cuts.forEach((c, i) => {
    const li = document.createElement('li'); li.textContent = `✂ ${fmt2(c[0])} → ${fmt2(c[1])} `;
    const x = document.createElement('button'); x.textContent = 'Desfazer'; x.addEventListener('click', () => { E.cuts.splice(i, 1); edRender(); });
    li.appendChild(x); ol.appendChild(li);
  });
  $('#edCutBtn').textContent = E.cutA == null ? '✂ Começar corte aqui' : '✂ Terminar corte aqui';
  $('#edCutBtn').classList.toggle('primary', E.cutA != null);
  $('#edStartLbl').textContent = fmt2(E.start); $('#edEndLbl').textContent = fmt2(E.end);
}

/* ---------- cortar ---------- */
$('#edSetStart').addEventListener('click', () => { E.start = Math.min(edVid.currentTime, E.end - 0.5); edRender(); toast('Começo marcado'); });
$('#edSetEnd').addEventListener('click', () => { E.end = Math.max(edVid.currentTime, E.start + 0.5); edRender(); toast('Fim marcado'); });
$('#edCutBtn').addEventListener('click', () => {
  const t = edVid.currentTime;
  if (E.cutA == null) { E.cutA = t; edVid.play(); toast('Dê play até o fim do trecho e toque de novo'); }
  else {
    const a = Math.min(E.cutA, t), b = Math.max(E.cutA, t); E.cutA = null; edVid.pause();
    if (b - a < 0.2) return toast('Trecho muito curto');
    E.cuts.push([a, b]); E.cuts.sort((x, y) => x[0] - y[0]); toast('Trecho cortado ✂');
  }
  edRender();
});
setInterval(() => { if (E.cutA != null) edRender(); }, 200);
function keepSegs() {
  let segs = [[E.start, E.end]];
  for (const [a, b] of E.cuts) segs = segs.flatMap(([s, e]) => (b <= s || a >= e) ? [[s, e]] : [[s, a], [b, e]].filter(([x, y]) => y - x > 0.1));
  return segs;
}
const keepLen = () => keepSegs().reduce((t, [a, b]) => t + b - a, 0) + (E.coverCv && E.coverInVideo ? COVER_DUR : 0);

/* ---------- capa ---------- */
const COVER_DUR = 1.2;
function drawCover(c, W, H) {
  const g = c.getContext('2d'); g.drawImage(E.coverCv, 0, 0, W, H);
  const t = (E.title || '').trim().toUpperCase(); if (!t) return;
  const fs = Math.round(Math.min(W, H) * 0.11); g.font = `900 ${fs}px -apple-system,"Arial Black",Impact,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = []; let cur = '';
  for (const w of t.split(/\s+/)) { const x = cur ? cur + ' ' + w : w; if (g.measureText(x).width > W * 0.88 && cur) { lines.push(cur); cur = w; } else cur = x; }
  if (cur) lines.push(cur);
  const lh = fs * 1.08, y0 = H * 0.24 - (lines.length - 1) * lh / 2;
  lines.slice(0, 4).forEach((l, i) => {
    const y = y0 + i * lh; g.lineWidth = fs * 0.2; g.strokeStyle = '#000'; g.strokeText(l, W / 2, y);
    g.fillStyle = i % 2 ? '#ffd60a' : '#fff'; g.fillText(l, W / 2, y);
  });
}
function renderCoverPreview() {
  const img = $('#edCoverPrev');
  if (!E.coverCv) { img.classList.add('hidden'); return; }
  const c = document.createElement('canvas'); c.width = E.coverCv.width; c.height = E.coverCv.height; drawCover(c, c.width, c.height);
  img.src = c.toDataURL('image/jpeg', 0.85); img.classList.remove('hidden');
}
$('#edCoverGrab').addEventListener('click', () => {
  if (!edVid.videoWidth) return toast('Vídeo ainda carregando');
  const c = document.createElement('canvas'); c.width = edVid.videoWidth; c.height = edVid.videoHeight;
  c.getContext('2d').drawImage(edVid, 0, 0); E.coverCv = c; E.coverT = edVid.currentTime; renderCoverPreview(); toast('Capa escolhida 📸');
});
$('#edTitle').addEventListener('input', (e) => { E.title = e.target.value; renderCoverPreview(); });
$('#edCoverIn').addEventListener('change', (e) => { E.coverInVideo = e.target.checked; });
$('#edCoverSave').addEventListener('click', async () => {
  if (!E.coverCv) return toast('Escolha um frame primeiro');
  const c = document.createElement('canvas'); c.width = E.coverCv.width; c.height = E.coverCv.height; drawCover(c, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)), file = new File([blob], 'capa-react.jpg', { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch {} }
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); }
});

/* ---------- música ---------- */
let edSrc = null, edGain = null, edAn = null, edAnData = null, musicBuf = null, musicNode = null, musicGain = null;
function hookEdAudio() {
  if (edSrc) return;
  edSrc = ac.createMediaElementSource(edVid); edGain = ac.createGain();
  edAn = ac.createAnalyser(); edAn.fftSize = 1024; edAnData = new Uint8Array(edAn.fftSize);
  edSrc.connect(edGain); edGain.connect(ac.destination); edSrc.connect(edAn);
  musicGain = ac.createGain(); musicGain.gain.value = 0; musicGain.connect(ac.destination);
}
$('#edMusicFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  ensureAudio(); hookEdAudio();
  try {
    const ab = await f.arrayBuffer(); musicBuf = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));
    E.music = true; E.musicName = f.name; $('#edMusicName').textContent = '🎵 ' + f.name; $('#edMusicDel').classList.remove('hidden');
    toast('Música adicionada');
  } catch { toast('Não consegui abrir essa música'); }
});
$('#edMusicDel').addEventListener('click', () => { E.music = null; musicBuf = null; stopMusic(); $('#edMusicName').textContent = 'Nenhuma música'; $('#edMusicDel').classList.add('hidden'); });
$('#edMusicVol').addEventListener('input', (e) => { E.musicVol = +e.target.value; });
$('#edDuck').addEventListener('change', (e) => { E.duck = e.target.checked; });
function startMusic(offset = 0) {
  stopMusic(); if (!musicBuf) return;
  musicNode = ac.createBufferSource(); musicNode.buffer = musicBuf; musicNode.loop = true; musicNode.connect(musicGain);
  musicNode.start(0, offset % musicBuf.duration);
}
function stopMusic() { if (musicNode) { try { musicNode.stop(); } catch {} musicNode = null; } }
// na prévia a música toca junto
edVid.addEventListener('play', () => { if (musicBuf && !E.busy) startMusic(edVid.currentTime); });
edVid.addEventListener('pause', () => { if (!E.busy) stopMusic(); });
let duckHold = 0;
function edMusicDuck() {
  if (!musicGain || !musicNode) return;
  let lvl = 0;
  if (edAn && !edVid.paused) { edAn.getByteTimeDomainData(edAnData); let s = 0; for (let i = 0; i < edAnData.length; i++) { const d = (edAnData[i] - 128) / 128; s += d * d; } lvl = Math.sqrt(s / edAnData.length); }
  if (lvl > 0.05) duckHold = performance.now() + 500;
  const target = E.musicVol * (E.duck && performance.now() < duckHold ? 0.3 : 1);
  musicGain.gain.setTargetAtTime(target, ac.currentTime, 0.15);
}

/* ---------- exportar ---------- */
$('#edExport').addEventListener('click', exportEdit);
function waitEv(el, ev) { return new Promise((r) => el.addEventListener(ev, r, { once: true })); }
function frameUntil(fn) { return new Promise((res) => { const f = () => { if (fn()) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); }
async function exportEdit() {
  if (E.busy) return; const segs = keepSegs();
  if (!segs.length || !E.dur) return toast('Nada pra exportar');
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Esse aparelho não exporta. Atualize o iOS.');
  ensureAudio(); hookEdAudio();
  edVid.play().then(() => edVid.pause()).catch(() => {}); // destrava no toque (iPhone)
  E.busy = true; edVid.pause(); stopMusic();
  const ov = $('#edProgress'), bar = $('#edProgBar'); ov.classList.remove('hidden');
  let W = edVid.videoWidth, H = edVid.videoHeight; const k = Math.min(1, 1280 / Math.max(W, H)); W = Math.round(W * k / 2) * 2; H = Math.round(H * k / 2) * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const dest = ac.createMediaStreamDestination(); edGain.connect(dest); musicGain.connect(dest);
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : {}); const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const total = keepLen(); let done = 0;
  const prog = (x) => { bar.style.width = Math.min(100, x / total * 100) + '%'; $('#edProgTxt').textContent = `Exportando… ${Math.round(Math.min(100, x / total * 100))}%`; };
  try {
    // capa parada no começo
    if (E.coverCv && E.coverInVideo) {
      drawCover(c, W, H); rec.start(500); if (musicBuf) startMusic(0);
      const t0 = performance.now(); await frameUntil(() => { drawCover(c, W, H); prog((performance.now() - t0) / 1000); return performance.now() - t0 >= COVER_DUR * 1000; });
      done = COVER_DUR; rec.pause && rec.pause();
    }
    for (const [a, b] of segs) {
      edVid.currentTime = a; await waitEv(edVid, 'seeked'); g.drawImage(edVid, 0, 0, W, H);
      if (rec.state === 'inactive') { rec.start(500); if (musicBuf) startMusic(0); } else if (rec.state === 'paused') rec.resume();
      await edVid.play();
      await frameUntil(() => { g.drawImage(edVid, 0, 0, W, H); prog(done + edVid.currentTime - a); return edVid.currentTime >= b - 0.02 || edVid.ended; });
      edVid.pause(); done += b - a; if (rec.pause) rec.pause();
    }
    if (rec.state === 'paused') rec.resume();
    const stopped = waitEv(rec, 'stop'); rec.stop(); await stopped;
    const type = rec.mimeType || mime || 'video/mp4';
    lastBlob = new Blob(chunks, { type });
    const url = URL.createObjectURL(lastBlob), ext = type.includes('mp4') ? 'mp4' : 'webm';
    $('#resultVid').src = url; $('#dlBtn').href = url; $('#dlBtn').download = 'react-editado-' + Date.now() + '.' + ext;
    $('#editor').classList.add('hidden'); $('#result').classList.remove('hidden'); $('#lastBtn').classList.remove('hidden');
    toast('Vídeo editado pronto ✅');
  } catch (e) { console.warn(e); toast('Erro ao exportar: ' + e.message, 4000); try { rec.state !== 'inactive' && rec.stop(); } catch {} }
  finally { stopMusic(); try { edGain.disconnect(dest); musicGain.disconnect(dest); } catch {} ov.classList.add('hidden'); E.busy = false; }
}
