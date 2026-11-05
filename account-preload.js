'use strict';
const { ipcRenderer } = require('electron');

// Espelha somente cliques reais em controles; nunca envia texto digitado.
const compact = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
function pathOf(el) {
  const parts = [];
  for (let node = el; node && node !== document.body && node.parentElement; node = node.parentElement) {
    const siblings = Array.from(node.parentElement.children).filter(x => x.tagName === node.tagName);
    parts.unshift(node.tagName.toLowerCase() + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''));
  }
  return parts.length ? `body > ${parts.join(' > ')}` : 'body';
}
window.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const target = event.target.closest('button,a,[role="button"],[role="tab"],[role="menuitem"],[role="option"],summary,label,[onclick],[tabindex]');
  if (!target || target.matches('input,textarea,select,[contenteditable="true"]') || target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const rect = target.getBoundingClientRect();
  ipcRenderer.send('pokeidle-echo-click', {
    path: pathOf(target), tag: target.tagName.toLowerCase(), text: compact(target.getAttribute('aria-label') || target.title || target.innerText || target.value),
    fx: rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : .5,
    fy: rect.height ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : .5
  });
}, true);
