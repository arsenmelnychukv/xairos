import { $ } from '../lib/util';
import { live, sortTasks } from '../store';
import { bindQuickAdd, bindRows, rowHtml } from './tasks';

const Q = [
  { p: 5, name: 'Urgent & Important', c: 'var(--prio-high)' },
  { p: 3, name: 'Not Urgent & Important', c: 'var(--prio-med)' },
  { p: 1, name: 'Urgent & Unimportant', c: 'var(--prio-low)' },
  { p: 0, name: 'Not Urgent & Unimportant', c: 'var(--text-3)' },
];

export function renderMatrix() {
  const main = $('#main');
  const L = live().filter(t => !t.done);
  main.innerHTML = `<div class="topbar"><h1>Eisenhower Matrix</h1></div><div class="content"><div class="matrix">${Q.map((q, i) => { const items = sortTasks(L.filter(t => (t.priority || 0) === q.p)); return `
    <div class="quad" data-drop="zone" data-zone data-pri="${q.p}" style="--qc:${q.c}"><h3><span class="num" aria-hidden="true">${['I', 'II', 'III', 'IV'][i]}</span><span class="nm">${q.name}</span><span class="cnt" aria-label="${items.length} open">${items.length}</span></h3>
      <div class="list">${items.map(t => rowHtml(t, { showList: true, drop: true })).join('') || `<div class="qe">Drop tasks here</div>`}</div>
      <label class="qa"><svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><input id="mq${i}" placeholder="Add task" autocomplete="off"><span class="chips" id="mqc${i}"></span></label>
    </div>`; }).join('')}</div></div>`;
  bindRows(main);
  Q.forEach((q, i) => bindQuickAdd($<HTMLInputElement>('#mq' + i), $('#mqc' + i), () => ({ priority: q.p })));
}
