/* Reagindo — teleprompter por cima da tela (fica fora do canvas, então NÃO entra na gravação). */
'use strict';
const P = Object.assign({ text: '', speed: 1, size: 26, height: 28, auto: true, visible: false },
  (() => { try { return JSON.parse(localStorage.getItem('reagindo-prompter') || '{}'); } catch { return {}; } })());
const PR = { pos: 0, playing: false, last: 0 };
const pEl = $('#prompter'), pScroll = $('#pScroll'), pInner = $('#pInner');
function pSave() { try { localStorage.setItem('reagindo-prompter', JSON.stringify(P)); } catch {} }

function pApply() {
  $('#pText').value = P.text; $('#pSpeed').value = P.speed; $('#pSize').value = P.size; $('#pHeight').value = P.height; $('#pAuto').checked = P.auto;
  pInner.textContent = P.text || 'Escreva seu roteiro no ✎';
  pInner.style.fontSize = P.size + 'px'; pEl.style.height = P.height + 'vh';
  pEl.classList.toggle('hidden', !P.visible); $('#tbPrompter').classList.toggle('on', P.visible);
  $('#pSpeedLbl').textContent = P.speed.toFixed(1) + 'x'; $('#pPlay').textContent = PR.playing ? '❚❚' : '▶';
}
function pShow(on) { P.visible = on; pSave(); pApply(); }
function pPlay(on) { PR.playing = on; PR.last = performance.now(); pApply(); }

$('#tbPrompter').addEventListener('click', () => { if (!P.text) openSheet('#prompterSheet'); else pShow(!P.visible); });
$('#pText').addEventListener('input', (e) => { P.text = e.target.value; pSave(); pApply(); });
$('#pSpeed').addEventListener('input', (e) => { P.speed = +e.target.value; pSave(); pApply(); });
$('#pSize').addEventListener('input', (e) => { P.size = +e.target.value; pSave(); pApply(); });
$('#pHeight').addEventListener('input', (e) => { P.height = +e.target.value; pSave(); pApply(); });
$('#pAuto').addEventListener('change', (e) => { P.auto = e.target.checked; pSave(); });
$('#pShow').addEventListener('click', () => { closeSheets(); PR.pos = 0; pShow(true); });
$('#pHide').addEventListener('click', () => { closeSheets(); pShow(false); pPlay(false); });
$('#pPlay').addEventListener('click', () => pPlay(!PR.playing));
$('#pSlow').addEventListener('click', () => { P.speed = Math.max(0.3, +(P.speed - 0.2).toFixed(1)); pSave(); pApply(); });
$('#pFast').addEventListener('click', () => { P.speed = Math.min(4, +(P.speed + 0.2).toFixed(1)); pSave(); pApply(); });
$('#pRestart').addEventListener('click', () => { PR.pos = 0; });
$('#pEdit').addEventListener('click', () => { pPlay(false); openSheet('#prompterSheet'); });
$('#pClose').addEventListener('click', () => { pShow(false); pPlay(false); });

// arrastar o texto com o dedo pra voltar/avançar; tocar = pausar/continuar
let pDrag = null;
pScroll.addEventListener('pointerdown', (e) => { pScroll.setPointerCapture(e.pointerId); pDrag = { y: e.clientY, pos: PR.pos, moved: false }; });
pScroll.addEventListener('pointermove', (e) => { if (!pDrag) return; const dy = e.clientY - pDrag.y; if (Math.abs(dy) > 6) pDrag.moved = true; PR.pos = Math.max(0, pDrag.pos - dy); });
pScroll.addEventListener('pointerup', () => { if (pDrag && !pDrag.moved) pPlay(!PR.playing); pDrag = null; });

// começa a rolar junto com a gravação
window.prompterOnRec = (on) => { if (!P.visible) return; if (on && P.auto) pPlay(true); if (!on) pPlay(false); };

(function pLoop() {
  requestAnimationFrame(pLoop);
  const now = performance.now(), dt = Math.min(0.1, (now - PR.last) / 1000); PR.last = now;
  if (P.visible && PR.playing && !pDrag) {
    PR.pos += dt * P.speed * P.size * 1.4; // ~1 linha por segundo em 1.0x
    const max = Math.max(0, pInner.offsetHeight - pScroll.clientHeight * 0.35);
    if (PR.pos >= max) { PR.pos = max; pPlay(false); }
  }
  pInner.style.transform = `translateY(${-PR.pos}px)`;
})();
pApply();
