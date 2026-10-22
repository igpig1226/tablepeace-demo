// Interactive product tour. Every person, place and result in this file is fictional.
const capRoot = document.getElementById('cap-preview');
const capState = {slot:1, venue:0, reminded:false, template:'project', history:'all', rank:50, access:{wheelchair:false,captions:false,quiet:true}, automation:1, subsidy:0, split:'equal'};
const capItems = {
  calendar:{eyebrow:'CALENDAR / 时间交集',title:'把空闲时间，叠成共同窗口。',desc:'点选时间窗口，查看四位虚构成员的可参加情况。',html:() => `<div class="cap-slots">${[['周五 16:00','2 / 4 可参加'],['周五 18:00','4 / 4 可参加'],['周六 10:00','3 / 4 可参加']].map((x,i)=>`<button class="cap-slot ${i===capState.slot?'active':''}" data-cap-action="slot" data-value="${i}"><span>${x[0]}</span><b>${x[1]}</b></button>`).join('')}</div><div class="cap-metric"><span>当前共同窗口</span><b>${['周五 16:00','周五 18:00','周六 10:00'][capState.slot]}</b><small>${[2,4,3][capState.slot]} / 4 位成员可参加 · 演示数据</small></div>`},
  venue:{eyebrow:'VENUE / 场地核验',title:'场地信息也进入决策证据。',desc:'营业时间、容量和预约状态分开核对，避免把“条件兼容”当作“场地可用”。',html:()=>`<div class="cap-detail-grid"><div><span>场地</span><b>学校图书馆研讨室</b></div><div><span>营业时间</span><b>08:00–22:00</b></div><div><span>容量</span><b>8 人</b></div><div><span>预约状态</span><b>需电话确认</b></div></div><button class="cap-primary" data-cap-action="verify">${capState.venue?'撤销人工核验':'记录已人工核验'}</button><p class="cap-note">${capState.venue?'演示记录：组织者已核对场地。':'场地状态：等待组织者核验。'} 页面内状态，刷新后重置。</p>`},
  remind:{eyebrow:'FOLLOW UP / 回应提醒',title:'只提醒真正需要回应的人。',desc:'把待回应、已提交与已确认分开，提醒不会替任何成员作出决定。',html:()=>`<div class="cap-list"><div><b>林同学</b><span>已确认</span></div><div><b>陈同学</b><span>已确认</span></div><div><b>周同学</b><span>已确认</span></div><div><b>许同学</b><span class="pending">${capState.reminded?'提醒已标记':'等待回应'}</span></div></div><button class="cap-primary" data-cap-action="remind">${capState.reminded?'重置提醒':'模拟发送提醒'}</button><p class="cap-note">演示操作不会向任何人发送消息。</p>`},
  template:{eyebrow:'REUSE / 团队模板',title:'重复的组织工作，直接从模板开始。',desc:'选择不同场景，预览需要收集的条件和默认决策步骤。',html:()=>`<div class="cap-pills">${[['project','项目聚会'],['club','社团活动'],['trip','小组出行']].map(([id,label])=>`<button class="${capState.template===id?'active':''}" data-cap-action="template" data-value="${id}">${label}</button>`).join('')}</div><div class="cap-metric"><span>模板预览</span><b>${{project:'项目聚会',club:'社团活动',trip:'小组出行'}[capState.template]}</b><small>${{project:'时间 · 预算 · 安静环境 · 场地核验',club:'时间 · 人数 · 费用 · 无障碍需求',trip:'时间 · 交通 · 预算 · 集合地点'}[capState.template]}</small></div>`},
  history:{eyebrow:'TRACE / 决策时间线',title:'每一次变化，都有来龙去脉。',desc:'按阶段查看虚构决策过程；方案修改会产生新版本。',html:()=>`<div class="cap-pills">${[['all','全部'],['plan','方案'],['confirm','确认']].map(([id,label])=>`<button class="${capState.history===id?'active':''}" data-cap-action="history" data-value="${id}">${label}</button>`).join('')}</div><div class="cap-timeline">${[['plan','09:20','创建三个候选方案'],['plan','09:34','图书馆时间改为 18:00 · v2'],['confirm','09:41','发起 v2 成员确认'],['confirm','09:47','3 / 4 位成员已确认']].filter(x=>capState.history==='all'||x[0]===capState.history).map(x=>`<div><time>${x[1]}</time><span>${x[2]}</span></div>`).join('')}</div><p class="cap-note">时间线使用虚构记录。</p>`},
  api:{eyebrow:'CONNECT / 工作流 API',title:'把决策状态接进现有工具。',desc:'预览组织工具可读取的结构化事件。字段仅包含公开状态，不包含个人原始条件。',html:()=>`<div class="cap-pills"><button class="active" data-cap-action="api" data-value="proposal">方案事件</button><button data-cap-action="api" data-value="confirmed">确认事件</button></div><pre class="cap-code" id="cap-code">${JSON.stringify({event:'proposal.created',room:'friday-meetup',option:'学校图书馆 · 18:00',status:'awaiting_confirmations',confirmed:0,expected:4},null,2)}</pre><p class="cap-note">字段格式示例。</p>`},
  rank:{eyebrow:'PREFERENCE / 偏好排序',title:'先满足底线，再讨论喜好。',desc:'硬条件不参与交易。拖动权重，观察软偏好如何影响两个可行方案的排序。',html:()=>`<label class="cap-range-label" for="cap-rank">安静环境偏好 <b id="cap-rank-value">${capState.rank}%</b></label><input id="cap-rank" type="range" min="0" max="100" value="${capState.rank}"><div class="cap-rank-list"><div><b>学校图书馆 · 18:00</b><span id="cap-rank-a">${Math.round(68+capState.rank*.25)} 分</span></div><div><b>安静咖啡空间 · 18:00</b><span id="cap-rank-b">${Math.round(88-capState.rank*.2)} 分</span></div></div><p class="cap-note">分数是用于展示排序机制的演示值。</p>`},
  explain:{eyebrow:'EXPLAIN / 冲突解释',title:'不只显示红灯，还解释原因。',desc:'将规则检查转换成能讨论、能行动的调整建议。',html:()=>`<div class="cap-pills"><button class="active" data-cap-action="explain" data-value="cafe">咖啡馆</button><button data-cap-action="explain" data-value="library">图书馆</button></div><div class="cap-metric" id="cap-explanation"><span>咖啡馆 · 16:00</span><b>3 人存在冲突</b><small>时间冲突 1 人、预算冲突 2 人、环境冲突 2 人。建议尝试更晚的时间与安静场地。</small></div>`},
  access:{eyebrow:'INCLUSION / 无障碍条件',title:'把参与门槛提前看见。',desc:'按需加入轮椅通行、字幕和安静环境条件；未知场地信息保持未知。',html:()=>`<div class="cap-checks"><label><input type="checkbox" data-cap-check="wheelchair" ${capState.access.wheelchair?'checked':''}>轮椅通行</label><label><input type="checkbox" data-cap-check="captions" ${capState.access.captions?'checked':''}>实时字幕</label><label><input type="checkbox" data-cap-check="quiet" ${capState.access.quiet?'checked':''}>安静环境</label></div><div class="cap-metric"><span>学校图书馆 · 18:00</span><b id="cap-access-status">${capState.access.wheelchair||capState.access.captions?'需要补充场地信息':'符合已记录条件'}</b><small id="cap-access-detail">${accessDetail()}</small></div>`},
  export:{eyebrow:'SHARE / 结果导出',title:'把结论带回原来的协作空间。',desc:'生成事实准确的摘要。人数、场地状态与确认状态都写清楚。',html:()=>`<div class="cap-metric"><span>分享摘要 · 演示</span><b>周五项目聚会</b><small id="cap-export-text">建议方案：学校图书馆，18:00 开始。0 个已记录硬条件冲突。场地待核实；成员确认进度 3/4。</small></div><div class="cap-actions"><button class="cap-primary" data-cap-action="copy">复制摘要</button><button class="cap-secondary" data-cap-action="download">下载文本</button><button class="cap-secondary" data-cap-action="calendar-export">下载日历事件</button><button class="cap-secondary" data-cap-action="report-export">下载复盘报告</button></div><p class="cap-note" id="cap-export-note">可发送到现有群聊，也可留作复盘记录。</p>`},
  automation:{eyebrow:'AGENT / 流程助手',title:'把组织者从反复催促中解放出来。',desc:'一步步推进收集、比较、核验和确认；每步都保留人工决定。',html:()=>`<div class="cap-steps">${['收集需求','比较方案','核验场地','成员确认'].map((label,i)=>`<div class="${i<capState.automation?'done':i===capState.automation?'current':''}"><span>${String(i+1).padStart(2,'0')}</span><b>${label}</b><small>${i<capState.automation?'已完成':i===capState.automation?'当前阶段':'等待前序步骤'}</small></div>`).join('')}</div><button class="cap-primary" data-cap-action="next-step">${capState.automation===3?'重新演示流程':'推进到下一步'}</button><p class="cap-note">流程状态仅保存在此页面。</p>`},
  budget:{eyebrow:'COST / 费用协同',title:'算清总费用，也尊重个人预算。',desc:'模拟补贴后的人均费用。真实预算仍由每位成员私下提交。',html:()=>`<div class="cap-detail-grid"><div><span>场地与活动总费用</span><b>¥120</b></div><div><span>参与人数</span><b>4 人</b></div></div><label class="cap-range-label" for="cap-subsidy">组织补贴 <b id="cap-subsidy-value">¥${capState.subsidy}</b></label><input id="cap-subsidy" type="range" min="0" max="120" step="10" value="${capState.subsidy}"><div class="cap-metric"><span>补贴后的人均费用</span><b id="cap-per-person">¥${Math.ceil((120-capState.subsidy)/4)}</b><small>仅展示均摊情景；不会自动修改任何人的预算上限。</small></div>`}
};

function openCapability(id) {
  const item = capItems[id];
  if (!item) return;
  document.querySelectorAll('.cap-card').forEach(card => card.classList.toggle('active',card.dataset.cap===id));
  capRoot.innerHTML = `<div class="cap-preview-label">${item.eyebrow} · 虚构样例</div><h4>${item.title}</h4><p>${item.desc}</p>${item.html()}`;
  capRoot.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
}

function accessDetail() {
  const missing = [capState.access.wheelchair?'轮椅通行':null,capState.access.captions?'实时字幕':null].filter(Boolean);
  return missing.length ? `${missing.join('、')}信息待人工核实。` : '已记录的安静环境要求可以满足。';
}

document.querySelectorAll('.cap-card').forEach(card => card.addEventListener('click',()=>openCapability(card.dataset.cap)));
capRoot.addEventListener('click',async event => {
  const button=event.target.closest('[data-cap-action]');
  if (!button) return;
  const action=button.dataset.capAction, value=button.dataset.value;
  if (action==='slot') {capState.slot=Number(value);openCapability('calendar');}
  if (action==='verify') {capState.venue=1-capState.venue;openCapability('venue');}
  if (action==='remind') {capState.reminded=!capState.reminded;openCapability('remind');}
  if (action==='template') {capState.template=value;openCapability('template');}
  if (action==='history') {capState.history=value;openCapability('history');}
  if (action==='automation') {openCapability('automation');}
  if (action==='next-step') {capState.automation=(capState.automation+1)%4;openCapability('automation');}
  if (action==='api') {
    capRoot.querySelectorAll('[data-cap-action="api"]').forEach(x=>x.classList.toggle('active',x===button));
    const payload=value==='confirmed'?{event:'decision.confirmed',room:'friday-meetup',option:'学校图书馆 · 18:00',confirmed:4,expected:4}:{event:'proposal.created',room:'friday-meetup',option:'学校图书馆 · 18:00',status:'awaiting_confirmations',confirmed:0,expected:4};
    document.getElementById('cap-code').textContent=JSON.stringify(payload,null,2);
  }
  if (action==='explain') {
    capRoot.querySelectorAll('[data-cap-action="explain"]').forEach(x=>x.classList.toggle('active',x===button));
    document.getElementById('cap-explanation').innerHTML=value==='cafe'?'<span>咖啡馆 · 16:00</span><b>3 人存在冲突</b><small>时间冲突 1 人、预算冲突 2 人、环境冲突 2 人。建议尝试更晚的时间与安静场地。</small>':'<span>学校图书馆 · 16:00</span><b>1 人存在冲突</b><small>预算与环境要求满足；1 人无法在 16:00 到场。改为 18:00 后可消除已记录冲突。</small>';
  }
  if (action==='copy') {
    try {await navigator.clipboard.writeText(document.getElementById('cap-export-text').textContent);document.getElementById('cap-export-note').textContent='摘要已复制。';}
    catch {document.getElementById('cap-export-note').textContent='复制失败。可手动选择上方文本。';}
  }
  if (action==='download') {
    const content='TablePeace 演示摘要\n'+document.getElementById('cap-export-text').textContent+'\n';
    const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='tablepeace-demo-summary.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    document.getElementById('cap-export-note').textContent='演示摘要已下载。';
  }
  if (action==='calendar-export') {
    const date=new Date(); date.setDate(date.getDate()+((5-date.getDay()+7)%7||7));
    const day=date.toISOString().slice(0,10).replaceAll('-','');
    const content=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TablePeace//Demo//ZH\r\nBEGIN:VEVENT\r\nUID:tablepeace-demo-${day}@example.invalid\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}\r\nDTSTART;TZID=Asia/Shanghai:${day}T180000\r\nDTEND;TZID=Asia/Shanghai:${day}T190000\r\nSUMMARY:周五项目聚会（演示）\r\nDESCRIPTION:学校图书馆。场地待核实，成员确认进度 3/4。\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    downloadCapFile('tablepeace-demo.ics',content,'text/calendar;charset=utf-8');
    document.getElementById('cap-export-note').textContent='演示日历事件已下载；日期为下一个周五。';
  }
  if (action==='report-export') {
    const content='# TablePeace 决策复盘（演示）\n\n项目：周五项目聚会\n\n初始方案：咖啡馆、学校图书馆、创客空间；已记录冲突人数分别为 3、1、2。\n\n调整：将学校图书馆与 18:00 组合，已记录硬条件冲突降至 0。\n\n当前状态：场地待核实；虚构成员确认进度 3/4。\n\n数据说明：本报告使用虚构样例，仅用于展示。\n';
    downloadCapFile('tablepeace-demo-report.md',content,'text/markdown;charset=utf-8');
    document.getElementById('cap-export-note').textContent='演示复盘报告已下载。';
  }
});

function downloadCapFile(filename,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

capRoot.addEventListener('input',event => {
  if (event.target.id==='cap-rank') {
    capState.rank=Number(event.target.value);
    document.getElementById('cap-rank-value').textContent=`${capState.rank}%`;
    document.getElementById('cap-rank-a').textContent=`${Math.round(68+capState.rank*.25)} 分`;
    document.getElementById('cap-rank-b').textContent=`${Math.round(88-capState.rank*.2)} 分`;
  }
  if (event.target.id==='cap-subsidy') {
    capState.subsidy=Number(event.target.value);
    document.getElementById('cap-subsidy-value').textContent=`¥${capState.subsidy}`;
    document.getElementById('cap-per-person').textContent=`¥${Math.ceil((120-capState.subsidy)/4)}`;
  }
  if (event.target.dataset.capCheck) {
    capState.access[event.target.dataset.capCheck]=event.target.checked;
    const unknown=capState.access.wheelchair||capState.access.captions;
    document.getElementById('cap-access-status').textContent=unknown?'需要补充场地信息':'符合已记录条件';
    document.getElementById('cap-access-detail').textContent=accessDetail();
  }
});
