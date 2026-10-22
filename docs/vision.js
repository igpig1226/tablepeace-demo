// Concept interactions use only hard-coded fictional samples. No external service is called.
const visionTabs = [...document.querySelectorAll('.vision-tab')];
const visionPanels = [...document.querySelectorAll('.vision-panel')];

function openVision(id) {
  visionTabs.forEach(tab => {
    const active = tab.dataset.vision === id;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  visionPanels.forEach(panel => { panel.hidden = panel.id !== `vision-${id}`; });
}

visionTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => openVision(tab.dataset.vision));
  tab.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visionTabs.length - 1 :
      (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + visionTabs.length) % visionTabs.length;
    openVision(visionTabs[next].dataset.vision);
    visionTabs[next].focus();
  });
});

const notes = [
  {text:'“周五六点以后有空，预算最好别超过 20 元，想找个安静点的地方。”', tags:[['可参加时间','18:00 后'],['预算上限','¥20'],['环境要求','安静']]},
  {text:'“下午四点就能到，花费不要高于 50 元，环境都可以。”', tags:[['可参加时间','16:00 后'],['预算上限','¥50'],['环境要求','不限']]},
  {text:'“想去图书馆，但我还没有确认那天的空闲时间。”', tags:[['地点偏好','图书馆'],['可参加时间','未确认'],['预算上限','未提及']]}
];
let noteIndex = 0;
document.getElementById('vision-next-note').addEventListener('click', () => {
  noteIndex = (noteIndex + 1) % notes.length;
  document.getElementById('vision-note').textContent = notes[noteIndex].text;
  const tags = document.getElementById('vision-tags');
  tags.replaceChildren(...notes[noteIndex].tags.map(([label, value]) => {
    const chip = document.createElement('span');
    chip.append(label + ' ');
    const strong = document.createElement('b');
    strong.textContent = value;
    chip.append(strong);
    return chip;
  }));
});

const scenarios = {
  cafe: {title:'咖啡馆 · 16:00', detail:'¥35 / 人 · 热闹 · 场地未核实', fit:'1/4', counts:[1,2,2], insight:'3 人存在至少一项冲突。先看清原因，再调整方案。'},
  library: {title:'学校图书馆 · 16:00', detail:'¥0 / 人 · 安静 · 场地未核实', fit:'3/4', counts:[1,0,0], insight:'预算和环境冲突已消除；仍有 1 人无法在 16:00 到场。'},
  rescue: {title:'学校图书馆 · 18:00', detail:'¥0 / 人 · 安静 · 场地未核实', fit:'4/4', counts:[0,0,0], insight:'0 个已记录硬条件冲突。场地仍需核实，成员仍需分别确认。'}
};

document.querySelectorAll('.vision-scenario').forEach(button => {
  button.addEventListener('click', () => {
    const scenario = scenarios[button.dataset.scenario];
    document.querySelectorAll('.vision-scenario').forEach(choice => {
      const active = choice === button;
      choice.classList.toggle('active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('vision-scenario-title').textContent = scenario.title;
    document.getElementById('vision-scenario-detail').textContent = scenario.detail;
    document.getElementById('vision-scenario-fit').textContent = scenario.fit;
    document.getElementById('vision-scenario-insight').textContent = scenario.insight;
    ['time','budget','environment'].forEach((name, index) => {
      document.getElementById(`vision-bar-${name}`).style.width = `${scenario.counts[index] * 25}%`;
      document.getElementById(`vision-count-${name}`).textContent = `${scenario.counts[index]} 人`;
    });
  });
});
