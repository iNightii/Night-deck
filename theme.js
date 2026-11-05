const ids=['bg','bar','card','button','accent','text'];
const inputs=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
window.themeApi.onThemeState(theme=>{ids.forEach(id=>{if(theme[id]) inputs[id].value=theme[id]; document.body.style.background=theme.bar||'#111827'; document.querySelector('.panel').style.background=theme.bar||'#111827';});});
ids.forEach(id=>inputs[id].addEventListener('input',e=>window.themeApi.update(id,e.target.value)));
document.getElementById('reset').addEventListener('click',()=>window.themeApi.reset());
document.getElementById('close').addEventListener('click',()=>window.themeApi.close());
