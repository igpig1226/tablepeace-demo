const initialOptions = [
  {id:'A',name:'咖啡馆',venue:'咖啡馆',start:'16:00',cost:35,noise:'热闹',duration:60},
  {id:'B',name:'学校图书馆',venue:'学校图书馆',start:'16:00',cost:0,noise:'安静',duration:60},
  {id:'C',name:'创客空间',venue:'创客空间',start:'18:00',cost:20,noise:'适中',duration:60}
];
// Four fictional participants, used only to explain the deterministic rules.
const people = [
  {from:'18:00',to:'20:00',budget:20,quiet:true},
  {from:'16:00',to:'20:00',budget:50,quiet:false},
  {from:'16:00',to:'20:00',budget:20,quiet:false},
  {from:'16:00',to:'20:00',budget:50,quiet:true}
];
const state = {view:'compare',options:initialOptions.map(x=>({...x})),selected:0,base:1,simulation:null,proposal:null,accepted:0};
const root = document.getElementById('workspace-content');
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const min = time => Number(time.slice(0,2))*60+Number(time.slice(3));
function inspect(option,person){
  const issues=[];
  if(min(person.from)>min(option.start)||min(option.start)+option.duration>min(person.to))issues.push('时间');
  if(option.cost>person.budget)issues.push('预算');
  if(person.quiet&&option.noise!=='安静')issues.push('环境');
  return issues;
}
function assess(option){
  const all=people.map(person=>inspect(option,person));
  return {blocked:all.filter(x=>x.length).length,time:all.filter(x=>x.includes('时间')).length,
    budget:all.filter(x=>x.includes('预算')).length,environment:all.filter(x=>x.includes('环境')).length};
}
function badge(n){return `<span class="status ${n===0?'compatible':'blocked'}">${n===0?'符合已记录条件':`${n} 人存在冲突`}</span>`}
function counter(label,value){return `<div class="ws-counter"><b>${value}</b><span>${label}</span></div>`}
function optionButtons(active){return state.options.map((o,i)=>`<button class="${i===active?'active':''}" data-action="select" data-index="${i}">${esc(o.name)}<small>${assess(o).blocked} 人冲突</small></button>`).join('')}
function compare(){
  const reports=state.options.map(assess),o=state.options[state.selected],r=reports[state.selected];
  const metric=(key,i)=>reports[i][key]?`<div class="bad">${reports[i][key]} 人冲突</div>`:'<div class="good">无冲突</div>';
  const row=(label,key)=>`<div class="rowhead">${label}</div>${state.options.map((_,i)=>metric(key,i)).join('')}`;
  return `<div class="ws-title"><div><div class="eyebrow">01 / 方案对比</div><h2>先看清问题，再决定怎么改</h2><p class="muted">硬性条件逐项计算；同一人可同时触发多个原因，但总冲突人数只计一次。</p></div></div><div class="ws-summary">${counter('完全兼容方案',reports.filter(x=>x.blocked===0).length)}${counter('存在冲突方案',reports.filter(x=>x.blocked>0).length)}${counter('已提交成员',people.length+'/4')}</div><div class="ws-grid"><div class="ws-card"><div class="eyebrow">兼容性矩阵</div><div class="ws-plan-tabs">${optionButtons(state.selected)}</div><div class="ws-matrix-wrap"><div class="ws-matrix" style="--n:${state.options.length}"><div class="head"></div>${state.options.map(x=>`<div class="head">${esc(x.name)}</div>`).join('')}${row('时间','time')}${row('预算','budget')}${row('环境','environment')}<div class="rowhead">总体</div>${reports.map(x=>`<div class="${x.blocked?'bad':'good'}">${x.blocked?x.blocked+' 人冲突':'符合条件'}</div>`).join('')}</div></div><p class="tiny muted" style="margin:15px 0 0">这里只展示匿名计数，不展示任何人的预算或可参加时段。</p></div><aside class="ws-card"><div class="eyebrow">当前方案</div><h3>${esc(o.name)}</h3>${badge(r.blocked)}<div class="divider"></div><div class="ws-reason"><span>时间冲突</span><b>${r.time}</b></div><div class="ws-reason"><span>预算冲突</span><b>${r.budget}</b></div><div class="ws-reason"><span>环境冲突</span><b>${r.environment}</b></div><p class="tiny muted" style="margin:17px 0">${o.start} 开始 · 60 分钟 · ¥${o.cost}/人 · ${o.noise}</p><div class="ws-warning">没有已记录冲突，不等于场地已核实或成员已同意。</div><button class="button" data-action="view" data-view="${r.blocked?'rescue':'decision'}">${r.blocked?'探索可行调整':'进入确认流程'}</button></aside></div>`;
}
function rescue(){
  const base=state.options[state.base],sim=state.simulation,baseReport=assess(base),simReport=sim?assess(sim):null;
  return `<div class="ws-title"><div><div class="eyebrow">02 / 方案重组</div><h2>改变方案，不改变任何人的底线</h2><p class="muted">仅组合已有地点属性与已有时间，费用、环境跟随地点。模拟不会改动原方案。</p></div></div><div class="notice blue">当前是虚构数据的页面内模拟。新方案不会保存到服务器，也不会发送给其他人。</div><div class="ws-three"><div class="ws-card"><div class="eyebrow">第一步</div><h3>选择原方案</h3>${state.options.map((o,i)=>`<button class="ws-choice ${i===state.base?'active':''}" data-action="base" data-index="${i}"><b>${esc(o.name)}</b><small>${o.start} · ${assess(o).blocked} 人冲突</small></button>`).join('')}</div><div class="ws-card"><div class="eyebrow">第二步</div><h3>重组已知选项</h3><label class="field"><span>地点与价格来自</span><select id="rescue-venue">${state.options.map(o=>`<option value="${o.id}" ${sim?.venue===o.venue?'selected':''}>${esc(o.venue)} · ¥${o.cost} · ${o.noise}</option>`).join('')}</select></label><label class="field"><span>时间来自</span><select id="rescue-time">${state.options.map(o=>`<option value="${o.id}" ${sim?.start===o.start?'selected':''}>${o.start} · ${esc(o.name)}</option>`).join('')}</select></label><p class="ws-step">时长沿用原方案：${base.duration} 分钟</p><button class="button" data-action="simulate">计算新组合</button><p class="tiny muted" style="margin:12px 0 0">试试“学校图书馆”与“18:00”。</p></div><div class="ws-card ws-result"><div class="eyebrow">第三步</div><h3>变化在哪里？</h3>${sim?`<span class="status simulated">模拟方案 · 尚未确认</span><h3>${esc(sim.name)}</h3><div class="ws-reason"><span>已解决的冲突人数</span><b>${Math.max(0,baseReport.blocked-simReport.blocked)}</b></div><div class="ws-reason"><span>剩余冲突人数</span><b>${simReport.blocked}</b></div><p class="tiny muted" style="margin:15px 0">${sim.start} · ¥${sim.cost}/人 · ${sim.noise}</p><div class="ws-warning">场地可用性尚未核实。0 个已记录冲突不代表大家已经同意。</div><button class="button" data-action="publish">加入演示候选方案</button>`:`<p class="tiny muted">选择已有地点和时间，然后运行规则计算。这里会展示冲突如何变化。</p><div class="ws-warning">不会更改任何成员的私人条件。</div>`}</div></div>`;
}
function decision(){
  const valid=state.options.map((o,i)=>({o,i,r:assess(o)})).filter(x=>x.r.blocked===0);
  const proposed=state.proposal===null?null:state.options[state.proposal];
  return `<div class="ws-title"><div><div class="eyebrow">03 / 最终确认</div><h2>可行，还需要每个人明确答应</h2><p class="muted">这是演示操作；按钮模拟虚构成员确认，不代表任何真实人做出了承诺。</p></div></div>${proposed?`<div class="ws-card"><div class="eyebrow">当前演示提案</div><h3>${esc(proposed.name)} · ${proposed.start}</h3><p class="tiny muted">${esc(proposed.venue)} · ¥${proposed.cost}/人 · ${proposed.noise} · 场地未核实</p>${state.accepted===4?'<div class="notice green">四位虚构成员均已在演示中确认；真实产品需要各自独立操作。</div>':'<div class="notice amber">等待演示确认。未回复不能视为同意。</div>'}<div class="ws-confirm"><b>${state.accepted}/4</b><span>演示成员已确认</span></div><div class="progress"><div class="progress-fill" style="width:${state.accepted*25}%"></div></div><div class="button-row" style="margin-top:18px"><button class="button" data-action="accept" ${state.accepted===4?'disabled':''}>模拟一位成员确认</button><button class="button-outline" data-action="summary">复制演示摘要</button></div></div>`:`<div class="ws-card"><h3>提出一个待确认方案</h3><p class="tiny muted">只有 0 个已记录冲突的方案可供选择。</p>${valid.length?`<label class="field"><span>选择方案</span><select id="proposal-option">${valid.map(({o,i})=>`<option value="${i}">${esc(o.name)} · ${o.start}</option>`).join('')}</select></label><button class="button" data-action="propose">发起演示确认</button>`:`<div class="ws-warning">现有方案都有冲突。先去“冲突探索”生成可行组合。</div><button class="button" data-action="view" data-view="rescue">去重组方案</button>`}</div>`}<div class="ws-card" style="margin-top:17px"><h3>状态不能混为一谈</h3><div class="ws-reason"><span>条件兼容</span><span>规则计算</span></div><div class="ws-reason"><span>场地核实</span><span>需人工检查</span></div><div class="ws-reason"><span>最终确认</span><span>需每人亲自接受</span></div></div>`;
}
function render(){
  document.querySelectorAll('.workspace-link').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view));
  root.innerHTML=state.view==='compare'?compare():state.view==='rescue'?rescue():decision();
}
function notify(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),3000)}
document.addEventListener('click',async event=>{
  const t=event.target.closest('[data-action],[data-view]');if(!t)return;
  const action=t.dataset.action;
  if(t.classList.contains('workspace-link')||action==='view'){state.view=t.dataset.view;render();return}
  if(action==='select'){state.selected=Number(t.dataset.index);render();return}
  if(action==='base'){state.base=Number(t.dataset.index);state.simulation=null;render();return}
  if(action==='simulate'){
    const venue=state.options.find(x=>x.id===document.getElementById('rescue-venue').value);
    const when=state.options.find(x=>x.id===document.getElementById('rescue-time').value);
    const base=state.options[state.base];
    const candidate={id:'S',name:`${venue.venue} · ${when.start}`,venue:venue.venue,start:when.start,cost:venue.cost,noise:venue.noise,duration:base.duration};
    if(state.options.some(x=>x.venue===candidate.venue&&x.start===candidate.start&&x.cost===candidate.cost&&x.noise===candidate.noise&&x.duration===candidate.duration)){notify('这个组合已经在候选方案中。');return}
    state.simulation=candidate;render();return;
  }
  if(action==='publish'){
    if(!state.simulation)return;
    const copy={...state.simulation,id:'R'+state.options.length,name:state.simulation.venue};
    state.options.push(copy);state.selected=state.options.length-1;state.simulation=null;state.view='compare';state.proposal=null;state.accepted=0;render();notify('新方案已加入本页演示；刷新页面后重置。');return;
  }
  if(action==='propose'){state.proposal=Number(document.getElementById('proposal-option').value);state.accepted=0;render();return}
  if(action==='accept'){state.accepted=Math.min(4,state.accepted+1);render();return}
  if(action==='summary'){
    const o=state.options[state.proposal];
    const text=`周五项目聚会（演示）：${o.name}，${o.start} 开始，约 ¥${o.cost}/人。${state.accepted}/4 位虚构成员在页面内模拟确认；场地尚未核实。`;
    try{await navigator.clipboard.writeText(text);notify('演示摘要已复制。')}catch{notify('浏览器无法访问剪贴板。')}
  }
});
render();
