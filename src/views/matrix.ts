import { $ } from '../lib/util';
import { live, sortTasks } from '../store';
import { bindQuickAdd, bindRows, rowHtml } from './tasks';

const Q = [
  { p: 5, name: 'Urgent & Important', c: 'var(--p-high)' },
  { p: 3, name: 'Not Urgent & Important', c: 'var(--p-med)' },
  { p: 1, name: 'Urgent & Unimportant', c: 'var(--p-low)' },
  { p: 0, name: 'Not Urgent & Unimportant', c: '52,178,107' },
];

export function renderMatrix() {
  const main = $('#main');
  const L = live().filter(t => !t.done);
  main.innerHTML = `<div class="topbar"><h1>Eisenhower Matrix</h1></div><div class="content"><div class="matrix">${Q.map((q, i) => `
    <div class="quad" data-drop="zone" data-zone data-pri="${q.p}"><h3><span class="num" style="background:rgb(${q.c})">${['I', 'II', 'III', 'IV'][i]}</span><span style="color:rgb(${q.c})">${q.name}</span></h3>
      <div class="list">${sortTasks(L.filter(t => (t.priority || 0) === q.p)).map(t => rowHtml(t, { showList: true, drop: true })).join('') || `<div style="color:var(--t3);font-size:12px;padding:8px 10px">Drop tasks here</div>`}</div>
      <label class="qa"><svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><input id="mq${i}" placeholder="Add task" autocomplete="off"><span class="chips" id="mqc${i}"></span></label>
    </div>`).join('')}</div></div>`;
  bindRows(main);
  Q.forEach((q, i) => bindQuickAdd($<HTMLInputElement>('#mq' + i), $('#mqc' + i), () => ({ priority: q.p })));
}
