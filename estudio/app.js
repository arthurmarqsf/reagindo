/* React Thurzão — app de react para tablet.
 * Vídeo do tablet em tela cheia + câmera frontal com moldura animada + sons reais + pop-up,
 * tudo desenhado num canvas e gravado (MediaRecorder) com áudio mixado: vídeo (abaixa quando você fala),
 * voz com tratamento "voz de rádio" e efeitos. Salva na pasta Download. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const cv = $('cv'), g = cv.getContext('2d', { alpha: false });
  const vid = $('vid'), cam = $('cam');
  const load = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const status = t => { $('status').textContent = t; };

  // ---------- layout (coordenadas no canvas de referência 1920x1080) ----------
  const LAYOUTS = {
    pequena: { rotulo: 'Cam pequena', e: '🎥', cam: [1500, 37, 340, 244], pill: true },
    grande:  { rotulo: 'Cam grande',  e: '📸', cam: [1190, 520, 680, 488], pill: true },
    eu:      { rotulo: 'Só eu',       e: '🙋', cam: [0, 0, 1920, 1080], full: true },
    video:   { rotulo: 'Só o vídeo',  e: '📺', cam: null }
  };
  const SONS = [
    ['01-gol-torcida', 'GOL!', '⚽'], ['02-torcida-explode', 'Torcida', '🏟️'], ['03-apito', 'Apito', '📣'],
    ['04-vaia-assobio', 'Vaia', '👎'], ['05-risada', 'Risada', '😂'], ['06-errou-buzina', 'Errou!', '❌'],
    ['07-trombone-triste', 'Trombone', '🎺'], ['08-impacto', 'Impacto', '💥'], ['09-suspense-coracao', 'Suspense', '💓'],
    ['10-aplausos', 'Aplausos', '👏'], ['11-siiiu-cr7', 'SIIIU', '🐐']
  ];

  const st = {
    layout: load('rt_layout', 'pequena'), camRect: null, camFrom: null, camAnimT0: 0,
    camStream: null, popupT0: -1, recorder: null, writer: null, writeChain: Promise.resolve(), chunks: [],
    recT0: 0, fileName: '', scale: 1, lastDraw: 0, buffers: {}, wake: null
  };
  if (!LAYOUTS[st.layout]) st.layout = 'pequena';

  // ---------- áudio ----------
  let ctx, mix, recDest, duck, vidGain, sfxGain, micNodes = [], micAnalyser, vidSrc;
  function audio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });
    mix = ctx.createGain();                       // vídeo + efeitos (vai pro fone e pra gravação)
    recDest = ctx.createMediaStreamDestination(); // tudo que vai pra gravação
    vidGain = ctx.createGain(); vidGain.gain.value = $('vVol').value / 100;
    duck = ctx.createGain();
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.75;
    vidSrc = ctx.createMediaElementSource(vid);
    vidSrc.connect(vidGain).connect(duck).connect(mix);
    sfxGain.connect(mix);
    const lim = ctx.createDynamicsCompressor(); // limitador do mix
    lim.threshold.value = -2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08; lim.knee.value = 0;
    mix.connect(lim); lim.connect(ctx.destination); lim.connect(recDest);
    setInterval(ducking, 50);
    return ctx;
  }
  const bq = (type, f, gain, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (gain !== undefined) b.gain.value = gain; if (q !== undefined) b.Q.value = q; return b; };
  const comp = (t, r, a, rel, k) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = t; c.ratio.value = r; c.attack.value = a; c.release.value = rel; c.knee.value = k; return c; };
  function ligarMic(track) {
    micNodes.forEach(n => { try { n.disconnect(); } catch (e) {} }); micNodes = [];
    if (!track) return;
    audio();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    const makeup = ctx.createGain(); makeup.gain.value = 1.6;
    // receita VOZ_RADIO (mesma do Teleprompter/editor)
    const chain = [pre, bq('highpass', 90, undefined, 0.7), bq('peaking', 200, -3, 1.4), bq('peaking', 420, -3.5, 1.2),
      bq('peaking', 2600, 5, 1.2), bq('peaking', 4500, 3, 1.4), bq('highshelf', 7500, 4),
      comp(-21, 4, 0.005, 0.08, 6), makeup, comp(-1.5, 20, 0.001, 0.05, 0)];
    let prev = src; chain.forEach(n => { prev.connect(n); prev = n; });
    micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 1024;
    prev.connect(micAnalyser); prev.connect(recDest); // voz só na gravação (não volta no fone)
    micNodes = [src, ...chain, micAnalyser];
  }
  const buf = new Float32Array(1024);
  function ducking() {
    let db = -90;
    if (micAnalyser) {
      micAnalyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      db = 10 * Math.log10(s / buf.length || 1e-9);
      $('meter').style.width = Math.max(0, Math.min(100, (db + 60) * 2)) + '%';
      $('meter').style.background = db > -8 ? '#f87171' : db > -20 ? '#fbbf24' : '#4ade80';
    }
    const falando = $('cDuck').checked && db > -36;
    duck.gain.setTargetAtTime(falando ? 0.3 : 1, ctx.currentTime, falando ? 0.05 : 0.35);
  }

  // ---------- sons (guardados no tablet, IndexedDB) ----------
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('react-sons', 1); r.onupgradeneeded = () => r.result.createObjectStore('sons'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbPut(k, v) { const db = await idb(); return new Promise(r => { const t = db.transaction('sons', 'readwrite'); t.objectStore('sons').put(v, k); t.oncomplete = r; }); }
  async function idbAll() { const db = await idb(); return new Promise(r => { const out = {}; const t = db.transaction('sons'); const c = t.objectStore('sons').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } else r(out); }; }); }
  async function carregarSons() {
    const all = await idbAll(); audio();
    for (const [k, ab] of Object.entries(all)) { try { st.buffers[k] = await ctx.decodeAudioData(ab.slice(0)); } catch (e) {} }
    const n = SONS.filter(s => st.buffers[s[0]]).length;
    $('sonsInfo').textContent = n ? `${n} de ${SONS.length} sons carregados${st.buffers.whoosh ? ' + whoosh' : ''}.` : 'Toque em "Importar sons" e escolha os MP3 da pasta Download/ReactSons.';
    document.querySelectorAll('[data-som]').forEach(b => b.disabled = !st.buffers[b.dataset.som]);
  }
  $('fSons').onchange = async e => {
    for (const f of e.target.files) { const k = f.name.replace(/\.[^.]+$/, ''); await idbPut(k, await f.arrayBuffer()); }
    await carregarSons(); status('Sons importados!');
  };
  function tocar(k, vol = 1) {
    const b = st.buffers[k]; if (!b) return; audio();
    const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = vol;
    s.connect(gn).connect(sfxGain); s.start();
    const btn = document.querySelector(`[data-som="${k}"]`);
    if (btn) { btn.classList.add('toca'); s.onended = () => btn.classList.remove('toca'); }
  }

  // ---------- câmera ----------
  async function ligarCamera() {
    audio();
    if (st.camStream) { st.camStream.getTracks().forEach(t => t.stop()); st.camStream = null; cam.srcObject = null; ligarMic(null);
      $('bCam').innerHTML = '<span class="e">📷</span>Ligar câmera'; status('Câmera desligada.'); return; }
    const fone = $('cFone').checked;
    const audioC = { echoCancellation: !fone, noiseSuppression: true, autoGainControl: false, sampleRate: { ideal: 48000 }, channelCount: { ideal: 1 } };
    try {
      st.camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: audioC });
    } catch (e) { status('Não consegui abrir a câmera: ' + e.message); return; }
    cam.srcObject = st.camStream; await cam.play().catch(() => {});
    ligarMic(st.camStream.getAudioTracks()[0]);
    const s = st.camStream.getVideoTracks()[0].getSettings();
    $('bCam').innerHTML = '<span class="e">📷</span>Desligar câmera';
    status(`Câmera ${s.width}x${s.height} • ${fone ? 'modo fone' : 'sem fone (cancelamento de eco)'}`);
  }
  $('bCam').onclick = ligarCamera;
  $('cFone').onchange = () => { if (st.camStream) { ligarCamera().then(ligarCamera); } };

  // ---------- vídeo ----------
  $('fVideo').onchange = e => {
    const f = e.target.files[0]; if (!f) return; audio();
    if (vid.src) URL.revokeObjectURL(vid.src);
    vid.src = URL.createObjectURL(f); vid.load();
    $('vazio').style.display = 'none'; status('Vídeo: ' + f.name);
  };
  const fmt = s => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function playPause() { audio(); if (!vid.src) return; vid.paused ? vid.play() : vid.pause(); }
  $('bPlay').onclick = playPause; cv.onclick = playPause;
  $('bBack').onclick = () => { vid.currentTime = Math.max(0, vid.currentTime - 5); };
  $('bFwd').onclick = () => { vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5); };
  $('seek').oninput = e => { if (vid.duration) vid.currentTime = vid.duration * e.target.value / 1000; };
  $('vVol').oninput = e => { if (vidGain) vidGain.gain.value = e.target.value / 100; };
  setInterval(() => {
    $('bPlay').textContent = vid.paused ? '▶' : '⏸';
    if (vid.duration) { $('seek').value = Math.round(1000 * vid.currentTime / vid.duration); $('ptime').textContent = fmt(vid.currentTime) + ' / ' + fmt(vid.duration); }
  }, 250);

  // ---------- botões ----------
  Object.entries(LAYOUTS).forEach(([k, L]) => {
    const b = document.createElement('button'); b.dataset.lay = k; b.innerHTML = `<span class="e">${L.e}</span>${L.rotulo}`;
    b.onclick = () => trocarLayout(k); $('layouts').appendChild(b);
  });
  SONS.forEach(([k, r, e]) => {
    const b = document.createElement('button'); b.dataset.som = k; b.disabled = true; b.innerHTML = `<span class="e">${e}</span>${r}`;
    b.onclick = () => tocar(k); $('sons').appendChild(b);
  });
  function marcarLayout() { document.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', b.dataset.lay === st.layout)); }
  function trocarLayout(k) {
    if (k === st.layout) return;
    st.camFrom = st.camRect; st.camAnimT0 = performance.now(); st.layout = k; save('rt_layout', k);
    tocar('whoosh', 0.6); marcarLayout();
  }
  marcarLayout();
  $('bPop').onclick = () => { st.popupT0 = performance.now(); };

  // ---------- desenho ----------
  const S = () => cv.width / 1920;
  function cover(src, sw, sh, x, y, w, h) {
    if (!sw || !sh) return;
    const r = Math.max(w / sw, h / sh), cw = w / r, ch = h / r;
    g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
  }
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  const ease = t => 1 - Math.pow(1 - t, 3);
  function alvoCam() {
    const L = LAYOUTS[st.layout]; if (!L.cam) return null;
    const s = S(); return L.cam.map(v => v * s);
  }
  function desenharCam(r, L, now) {
    const s = S(), [x, y, w, h] = r;
    const ok = st.camStream && cam.videoWidth;
    if (L.full) {
      g.save(); if ($('cEspelho').checked) { g.translate(cv.width, 0); g.scale(-1, 1); }
      if (ok) cover(cam, cam.videoWidth, cam.videoHeight, 0, 0, cv.width, cv.height); else { g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height); }
      g.restore();
      const vg = g.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * .35, cv.width / 2, cv.height / 2, cv.width * .62);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = vg; g.fillRect(0, 0, cv.width, cv.height);
      // faixa de nome
      const lx = 70 * s, ly = cv.height - 80 * s - 110 * s;
      g.fillStyle = 'rgba(20,14,36,.9)'; rr(lx, ly, 420 * s, 110 * s, 18 * s); g.fill();
      g.fillStyle = conic(lx, ly + 55 * s, now); g.fillRect(lx, ly + 10 * s, 8 * s, 90 * s);
      g.fillStyle = '#fff'; g.font = `900 ${44 * s}px Roboto,sans-serif`; g.fillText('THURZÃO', lx + 30 * s, ly + 58 * s);
      g.fillStyle = '#c4b5fd'; g.font = `700 ${19 * s}px Roboto,sans-serif`; g.fillText('FUTEBOL • REACT', lx + 30 * s, ly + 88 * s);
      return;
    }
    const rad = 22 * (w / 340) * 1; // proporcional ao tamanho
    // brilho + sombra
    g.save(); g.shadowColor = 'rgba(139,92,246,.55)'; g.shadowBlur = 34 * s; g.fillStyle = '#000'; rr(x - 6 * s, y - 6 * s, w + 12 * s, h + 12 * s, rad + 6 * s); g.fill(); g.restore();
    // anel com gradiente girando
    g.fillStyle = conic(x + w / 2, y + h / 2, now); rr(x - 6 * s, y - 6 * s, w + 12 * s, h + 12 * s, rad + 6 * s); g.fill();
    g.fillStyle = '#000'; rr(x - 2 * s, y - 2 * s, w + 4 * s, h + 4 * s, rad + 2 * s); g.fill();
    // câmera com cantos arredondados
    g.save(); rr(x, y, w, h, rad); g.clip();
    if ($('cEspelho').checked) { g.translate(x + w, 0); g.scale(-1, 1); g.translate(-x, 0); }
    if (ok) cover(cam, cam.videoWidth, cam.videoHeight, x, y, w, h); else { g.fillStyle = '#1c1530'; g.fillRect(x, y, w, h); }
    g.restore();
    if (L.pill) { // etiqueta THURZÃO REACT
      const k = w / 340, pw = 150 * k * s / s, ph = 26 * k;
      const px = x + w / 2 - pw / 2, py = y + h - ph / 2 + 2 * k;
      g.fillStyle = 'rgba(20,14,36,.95)'; rr(px, py, pw, ph, ph / 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1 * k; g.stroke();
      g.fillStyle = (now / 800 | 0) % 2 ? '#ef4444' : 'rgba(239,68,68,.35)'; g.beginPath(); g.arc(px + 14 * k, py + ph / 2, 4 * k, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = `800 ${12.5 * k}px Roboto,sans-serif`; g.fillText('THURZÃO', px + 24 * k, py + ph / 2 + 4.5 * k);
      g.fillStyle = '#c4b5fd'; g.font = `700 ${9 * k}px Roboto,sans-serif`; g.fillText('REACT', px + 102 * k, py + ph / 2 + 3.5 * k);
    }
  }
  function conic(cx, cy, now) {
    if (!g.createConicGradient) { const lg = g.createLinearGradient(cx - 200, cy, cx + 200, cy); lg.addColorStop(0, '#8b5cf6'); lg.addColorStop(.5, '#ec4899'); lg.addColorStop(1, '#22d3ee'); return lg; }
    const cg = g.createConicGradient((now / 6000) * Math.PI * 2, cx, cy);
    cg.addColorStop(0, '#8b5cf6'); cg.addColorStop(.33, '#ec4899'); cg.addColorStop(.66, '#22d3ee'); cg.addColorStop(1, '#8b5cf6');
    return cg;
  }
  function desenharPopup(now) {
    if (st.popupT0 < 0) return;
    const t = (now - st.popupT0) / 1000; if (t > 7) { st.popupT0 = -1; return; }
    const s = S(), inn = Math.min(1, t / .55), out = t > 6.2 ? Math.min(1, (t - 6.2) / .6) : 0;
    const off = (1 - ease(inn)) * -760 * s + ease(out) * -760 * s;
    const x = 60 * s + off, y = cv.height - 200 * s, w = 640 * s, h = 110 * s;
    g.save(); g.shadowColor = 'rgba(139,92,246,.5)'; g.shadowBlur = 30 * s;
    const bg = g.createLinearGradient(x, y, x + w, y + h); bg.addColorStop(0, 'rgba(14,11,24,.96)'); bg.addColorStop(1, 'rgba(40,22,70,.96)');
    g.fillStyle = bg; rr(x, y, w, h, 22 * s); g.fill(); g.restore();
    const lg = g.createLinearGradient(x + 18 * s, y, x + 80 * s, y + h); lg.addColorStop(0, '#8b5cf6'); lg.addColorStop(1, '#ec4899');
    g.fillStyle = lg; rr(x + 20 * s, y + 22 * s, 66 * s, 66 * s, 16 * s); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 44 * s, y + 40 * s); g.lineTo(x + 70 * s, y + 55 * s); g.lineTo(x + 44 * s, y + 70 * s); g.fill();
    g.font = `800 ${26 * s}px Roboto,sans-serif`; g.fillText('Curtiu o react?', x + 104 * s, y + 50 * s);
    g.fillStyle = '#c4b5fd'; g.font = `600 ${16 * s}px Roboto,sans-serif`; g.fillText('Se inscreve e ativa o sininho', x + 104 * s, y + 78 * s);
    const ok = t > 2.4;
    g.fillStyle = ok ? '#3f3f46' : '#ef4444'; rr(x + 380 * s, y + 32 * s, 190 * s, 46 * s, 12 * s); g.fill();
    g.fillStyle = '#fff'; g.font = `800 ${16 * s}px Roboto,sans-serif`; g.textAlign = 'center';
    g.fillText(ok ? 'INSCRITO ✓' : 'INSCREVER-SE', x + 475 * s, y + 61 * s); g.textAlign = 'left';
    const sw = t > 2.6 && t < 3.6 ? Math.sin((t - 2.6) * 18) * .3 * (3.6 - t) : 0;
    g.save(); g.translate(x + 600 * s, y + 40 * s); g.rotate(sw); g.font = `${30 * s}px sans-serif`; g.fillText('🔔', -15 * s, 22 * s); g.restore();
    if (t > 1 && t < 3) { // cursor clicando
      const p = Math.min(1, (t - 1) / 1.1), cx = x + (700 - 225 * ease(p)) * s, cy = y + (140 - 85 * ease(p)) * s, k = t > 2.1 && t < 2.35 ? .8 : 1;
      g.save(); g.translate(cx, cy); g.scale(k * s, k * s); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(22, 12); g.lineTo(12, 15); g.lineTo(8, 26); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
  }
  // governador: mede o tempo de desenho; se o tablet não aguenta 1080p, cai para 720p ANTES de gravar
  const perf = { n: 0, lento: 0, t0: 0 };
  function governar(custo, now) {
    if (st.recorder || cv.width < 1920) return;
    perf.n++; if (custo > 22) perf.lento++;
    if (!perf.t0) perf.t0 = now;
    if (now - perf.t0 > 4000) {
      if (perf.n > 60 && perf.lento / perf.n > 0.25) { $('sQual').value = '720'; aplicarQual(); status('Tablet no limite em 1080p: mudei para 720p para não travar.'); }
      perf.n = 0; perf.lento = 0; perf.t0 = now;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - st.lastDraw < 31) return; st.lastDraw = now; // ~30 fps
    const tIni = performance.now();
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    const L = LAYOUTS[st.layout];
    if (!L.full) { if (vid.videoWidth) cover(vid, vid.videoWidth, vid.videoHeight, 0, 0, cv.width, cv.height); }
    let alvo = alvoCam();
    if (alvo && !L.full) {
      if (st.camFrom) {
        const p = Math.min(1, (now - st.camAnimT0) / 380);
        if (p < 1) alvo = alvo.map((v, i) => st.camFrom[i] + (v - st.camFrom[i]) * ease(p)); else st.camFrom = null;
      }
      st.camRect = alvo; desenharCam(alvo, L, now);
    } else if (L.full) { desenharCam(alvo, L, now); st.camRect = LAYOUTS.pequena.cam.map(v => v * S()); }
    else st.camRect = LAYOUTS.pequena.cam.map(v => v * S());
    desenharPopup(now);
    if (vid.src && !vid.paused) governar(performance.now() - tIni, now);
  }
  requestAnimationFrame(frame);

  // ---------- qualidade ----------
  $('sQual').value = load('rt_q', '1080');
  function aplicarQual() { const q = $('sQual').value; cv.width = q === '720' ? 1280 : 1920; cv.height = q === '720' ? 720 : 1080; st.camFrom = null; save('rt_q', q); }
  $('sQual').onchange = aplicarQual; aplicarQual();

  // ---------- gravação ----------
  function pickMime() {
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (typeof MediaRecorder === 'undefined') return null;
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  async function discoOPFS(name) {
    try { const root = await navigator.storage.getDirectory(); const fh = await root.getFileHandle(name, { create: true }); return { handle: fh, writable: await fh.createWritable() }; } catch (e) { return null; }
  }
  async function limparOPFS(keep) {
    try { const root = await navigator.storage.getDirectory(); for await (const [n] of root.entries()) if (n.startsWith('take-') && n !== keep) root.removeEntry(n).catch(() => {}); } catch (e) {}
  }
  function baixar(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  async function gravar() {
    if (st.recorder) { st.recorder.stop(); return; }
    audio();
    if (!st.camStream) status('Dica: ligue a câmera para gravar sua voz e seu rosto.');
    const mime = pickMime(); if (mime === null) { alert('Este navegador não grava vídeo.'); return; }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm', id = stamp();
    st.fileName = `react-${id}.${ext}`;
    const disk = await discoOPFS(`take-${id}.${ext}`); limparOPFS(disk ? `take-${id}.${ext}` : null);
    const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...recDest.stream.getAudioTracks()]);
    // mesma qualidade da gravação do OBS: 1080p30 ~16 Mbps (720p 8 Mbps), áudio AAC 192 kbps
    const opts = { videoBitsPerSecond: cv.width >= 1920 ? 16000000 : 8000000, audioBitsPerSecond: 192000 }; if (mime) opts.mimeType = mime;
    try { st.recorder = new MediaRecorder(stream, opts); } catch (e) { st.recorder = new MediaRecorder(stream); }
    st.writer = disk; st.writeChain = Promise.resolve(); st.chunks = [];
    st.recorder.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      if (st.writer) { const w = st.writer.writable, d = e.data; st.writeChain = st.writeChain.then(() => w.write(d)).catch(() => st.chunks.push(d)); }
      else st.chunks.push(e.data);
    };
    st.recorder.onstop = finalizar;
    st.recorder.start(1000); st.recT0 = Date.now();
    $('bRec').classList.add('gravando'); $('bRec').textContent = '⏹ PARAR'; $('recbadge').classList.add('on'); $('sQual').disabled = true;
    try { st.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function finalizar() {
    const type = (st.recorder.mimeType || 'video/webm').split(';')[0], name = st.fileName, disk = st.writer, mem = st.chunks;
    st.recorder = null; st.writer = null; st.chunks = [];
    $('bRec').classList.remove('gravando'); $('bRec').textContent = '⏺ GRAVAR'; $('recbadge').classList.remove('on'); $('sQual').disabled = false;
    status('Salvando…');
    setTimeout(async () => {
      try {
        await st.writeChain;
        if (disk) { await disk.writable.close(); const f = await disk.handle.getFile(); baixar(new Blob([f, ...mem], { type }), name); }
        else baixar(new Blob(mem, { type }), name);
        status('Salvo em Download/' + name);
      } catch (e) { alert('Erro ao salvar: ' + e.message); }
    }, 300);
    if (st.wake) { st.wake.release().catch(() => {}); st.wake = null; }
  }
  $('bRec').onclick = gravar;
  setInterval(() => { if (st.recorder) { const s = (Date.now() - st.recT0) / 1000 | 0; $('rtime').textContent = String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); } }, 500);
  window.addEventListener('beforeunload', e => { if (st.recorder) { e.preventDefault(); e.returnValue = ''; } });

  // primeiro toque destrava o áudio
  document.addEventListener('pointerdown', () => audio(), { once: true });
  carregarSons().catch(() => {});
})();
