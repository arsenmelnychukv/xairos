import { $, esc } from '../lib/util';
import { live, sortTasks, ui } from '../store';
import { I, emptyArt } from '../ui/icons';
import { bindRows, rowHtml } from './tasks';

export function renderSearch() {
  const main = $('#main');
  main.innerHTML = `<div class="topbar"><h1>Search</h1></div><div class="content"><label class="search-box">${I.search}<input id="s-in" placeholder="Search tasks, descriptions, tags" value="${esc(ui.query)}" autocomplete="off"></label><div id="s-res"></div></div>`;
  const inp = $<HTMLInputElement>('#s-in'), res = $('#s-res');
  const run = () => {
    ui.query = inp.value; const q = ui.query.trim().toLowerCase();
    if (!q) { res.innerHTML = `<div class="empty">${emptyArt}<span>Find anything by title, description or #tag</span></div>`; return; }
    const hits = live().filter(t => (t.title || '').toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q) || (t.tags || []).some(g => g.includes(q.replace(/^#/, ''))));
    res.innerHTML = hits.length
      ? `<div class="sec-h" style="cursor:default"><span class="n">${hits.length}</span> result${hits.length > 1 ? 's' : ''}</div><div class="search-res">` + sortTasks(hits).map(t => rowHtml(t, { showList: true, q: ui.query.trim() })).join('') + '</div>'
      : `<div class="empty"><span>No results for “${esc(ui.query)}”</span></div>`;
    bindRows(res, false);
  };
  inp.oninput = run; run(); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
}
