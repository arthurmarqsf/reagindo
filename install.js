/* Reagindo — botão "Instalar app" (Android/Chrome e computador). No iPhone/iPad mostra o passo a passo do Safari. */
'use strict';
(function () {
  let deferred = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const btn = document.getElementById('installBtn'), help = document.getElementById('installHelp');
  function show() {
    if (isStandalone()) { btn.classList.add('hidden'); help.textContent = '✅ O app já está instalado neste aparelho.'; return; }
    btn.classList.remove('hidden');
    help.innerHTML = isIOS
      ? 'No iPhone/iPad: abra no <b>Safari</b> → <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.'
      : 'No Android: toque em <b>Instalar app</b>. Se não aparecer, use o menu <b>⋮</b> do Chrome → <b>Instalar app</b> (ou “Adicionar à tela inicial”).';
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e; show();
    try { if (!localStorage.getItem('reagindo-inst')) { localStorage.setItem('reagindo-inst', '1'); toast('📲 Dá pra instalar o Reagindo: Ajustes ⚙️ → Instalar app', 5000); } } catch {}
  });
  addEventListener('appinstalled', () => { deferred = null; toast('App instalado ✅'); show(); });
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch {} deferred = null; show(); }
    else toast(isIOS ? 'Safari → Compartilhar → Adicionar à Tela de Início' : 'Menu ⋮ do Chrome → Instalar app', 5000);
  });
  show();
})();
