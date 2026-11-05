'use strict';
const $ = id => document.getElementById(id);
const num = id => Math.max(0, Math.min(id === 'goldFloor' ? 1e12 : 1e7, Math.floor(Number($(id).value) || 0)));
let loading = false;
function fill(c) {
  loading = true;
  $('on').checked = !!c.on;
  $('ballsOn').checked = !!c.balls?.on; $('ballId').value = String(c.balls?.id ?? 4); $('ballKeep').value = c.balls?.keep ?? 30000; $('ballBelow').value = c.balls?.below ?? 5000;
  $('revivesOn').checked = !!c.revives?.on; $('reviveKeep').value = c.revives?.keep ?? 500; $('reviveBelow').value = c.revives?.below ?? 100;
  $('potionsOn').checked = !!c.potions?.on; $('potionId').value = String(c.potions?.id ?? 204); $('potionKeep').value = c.potions?.keep ?? 5000; $('potionBelow').value = c.potions?.below ?? 2000;
  $('potionFirst').checked = c.potionFirst !== false; $('goldFloor').value = c.goldFloor ?? 1000000;
  loading = false;
}
function collect() { return { on:$('on').checked, balls:{on:$('ballsOn').checked,id:Number($('ballId').value),keep:num('ballKeep'),below:num('ballBelow')}, revives:{on:$('revivesOn').checked,id:0,keep:num('reviveKeep'),below:num('reviveBelow')}, potions:{on:$('potionsOn').checked,id:Number($('potionId').value),keep:num('potionKeep'),below:num('potionBelow')}, potionFirst:$('potionFirst').checked, goldFloor:num('goldFloor') }; }
async function load() { const i=Number($('account').value); const c=await window.restockApi.get(i); fill(c); const kick=await window.restockApi.getKickRedeem(i); $('kickReward').value=kick||'off'; await refresh(); }
async function refresh() { const i=Number($('account').value); try { const s=await window.restockApi.summary(i); $('status').textContent = !s ? 'Script ainda não foi inicializado. Recarregue a conta do jogo.' : `Estado: ${s.on?'ATIVA':'desligada'} · ${s.connected?'conectada':'aguardando conexão'}\nTreinador: ${s.nick||'—'} · Ouro: ${Math.round(s.gold||0).toLocaleString('pt-BR')}\nPokébolas: ${(s.balls||[]).map(x=>`${x.name}: ${x.have}`).join(' | ')||'—'}\nRevives: ${(s.revives||[]).reduce((a,x)=>a+x.have,0)} · Poções: ${(s.potions||[]).reduce((a,x)=>a+x.have,0)}\n${(s.log||[]).slice(-8).join('\n')}`; } catch(e) { $('status').textContent=`Não foi possível ler o status: ${e.message}`; } }
$('account').onchange=load; $('refresh').onclick=refresh;
$('save').onclick=async()=>{ const i=Number($('account').value); const r=await window.restockApi.save(i,collect()); const k=await window.restockApi.setKickRedeem(i,$('kickReward').value); $('status').textContent=r?.ok?`Configuração salva. Recompra: ${collect().on?'ativada':'desativada'}. Resgate Kick: ${k||'desativado'}.`:`Falha ao salvar: ${r?.message||'erro desconhecido'}`; await refresh(); };
window.restockApi.onAccount(i=>{ $('account').value=String(i); load(); });
load(); setInterval(refresh,2500);
