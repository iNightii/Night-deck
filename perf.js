// Modos de desempenho das contas: normal | eco | ultra.
//  - eco:   contas fora de vista param de ser desenhadas (feito no main.js).
//  - ultra: eco + sem animações/sombras/filtros nas páginas e animação limitada a poucos quadros por segundo.
// Nada disso mexe na lógica do jogo: contadores e temporizadores continuam rodando.
const MODES = ['normal', 'eco', 'ultra'];

const ULTRA_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;' +
  'transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;' +
  'filter:none!important;backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important}';

// Roda DENTRO da página: limita requestAnimationFrame a um intervalo mínimo (ms). ms = 0 desliga o limite.
function pageThrottle(ms) {
  const w = window;
  if (!w.__piRaf) {
    const orig = w.requestAnimationFrame.bind(w), origCancel = w.cancelAnimationFrame.bind(w);
    const st = { ms: 0, timers: new Map(), n: 0 };
    w.requestAnimationFrame = cb => {
      if (!st.ms) return orig(cb);
      const id = 1e9 + (++st.n);           // não colide com os ids reais
      const t = setTimeout(() => { st.timers.delete(id); orig(cb); }, st.ms);
      st.timers.set(id, t);
      return id;
    };
    w.cancelAnimationFrame = id => {
      const t = st.timers.get(id);
      if (t) { clearTimeout(t); st.timers.delete(id); } else origCancel(id);
    };
    w.__piRaf = st;
  }
  w.__piRaf.ms = ms;
}
const throttleScript = ms => `(${pageThrottle.toString()})(${Math.max(0, Math.floor(Number(ms) || 0))})`;

// Aplica (ou remove) o modo ultra numa página. `state` guarda a chave do CSS inserido.
async function applyToPage(wc, mode, state, shownCount) {
  if (!wc || wc.isDestroyed()) return;
  const ultra = mode === 'ultra';
  try {
    if (ultra && !state.cssKey) state.cssKey = await wc.insertCSS(ULTRA_CSS);
    if (!ultra && state.cssKey) { await wc.removeInsertedCSS(state.cssKey); state.cssKey = null; }
    // 1 conta na tela: ~30 quadros/s; várias: ~10 quadros/s.
    await wc.executeJavaScript(throttleScript(ultra ? (shownCount <= 1 ? 33 : 100) : 0), true);
  } catch (_) {}
}

module.exports = { MODES, ULTRA_CSS, pageThrottle, throttleScript, applyToPage };
