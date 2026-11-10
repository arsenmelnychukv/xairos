/**
 * Apple Shortcuts quick add: personal tokens and a guide for
 * building "Add to xairos", so "Hey Siri, add to xairos" works. A token can
 * only add tasks (POST /api/xairos/quick-add); it cannot read anything.
 */
import type { ApiToken } from '../server/adapter';
import { $, esc } from '../lib/util';
import { server, session } from '../store';
import { closePop, popover } from '../ui/popover';
import { toast } from '../ui/toast';

const endpoint = () => location.origin + '/api/xairos/quick-add';
const when = (ms: number) => (ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'never');

export async function shortcutsPanel(anchor: Element) {
  if (!server.tokens || !session) return toast('This server has no API tokens');
  let list: ApiToken[] = [];
  try { list = await server.tokens.list(session.token); } catch (e) { return toast((e as Error).message); }
  draw(anchor, list, null);
}

function draw(anchor: Element, list: ApiToken[], fresh: string | null) {
  const p = popover(anchor, `
    <h4>Apple Shortcuts</h4>
    <p class="hint">Add tasks from Siri, the Share sheet or a Home Screen button. Each Shortcut uses a token that can only add tasks.</p>
    ${fresh ? `<div class="tok-new"><p class="hint"><b>Copy this token now.</b> It is not shown again.</p>
      <div class="tok-row"><code id="tok-val">${esc(fresh)}</code><button class="btn sec" id="tok-copy">Copy</button></div></div>
      ${guide(fresh)}` : ''}
    <div class="tok-list">${list.map(t => `<div class="tok"><div><b>${esc(t.name)}</b> <code>${esc(t.prefix)}…</code><br><span class="hint">Created ${esc(when(t.created))} · last used ${esc(when(t.lastUsed))}</span></div><button class="btn sec" data-rev="${esc(t.id)}">Revoke</button></div>`).join('') || '<p class="hint">No tokens yet.</p>'}</div>
    <div class="tok-row"><input class="dlg-input" id="tok-name" placeholder="Name, e.g. iPhone" maxlength="60"><button class="btn pri" id="tok-make">New token</button></div>
    ${fresh ? '' : `<details class="tok-guide"><summary>How to build the Shortcut</summary>${guide('kai_…')}</details>`}`, 380);
  $('#tok-make', p).onclick = async () => {
    try {
      const t = await server.tokens!.create(session!.token, $<HTMLInputElement>('#tok-name', p).value.trim() || 'iPhone');
      draw(anchor, [t, ...list], t.token);
    } catch (e) { toast((e as Error).message); }
  };
  p.querySelector<HTMLElement>('#tok-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(fresh!); toast('Token copied'); }
    catch { getSelection()?.selectAllChildren($('#tok-val', p)); toast('Select and copy the token'); }
  });
  p.querySelectorAll<HTMLElement>('[data-rev]').forEach(b => b.onclick = async () => {
    if (!confirm('Revoke this token? Shortcuts using it stop working.')) return;
    try { await server.tokens!.revoke(session!.token, b.dataset.rev!); draw(anchor, list.filter(t => t.id !== b.dataset.rev), null); toast('Token revoked'); }
    catch (e) { toast((e as Error).message); }
  });
  p.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
}

/** Step-by-step for the Shortcuts app. */
const guide = (token: string) => `<ol class="tok-steps">
  <li>Open <b>Shortcuts</b> on the iPhone, tap <b>+</b>, and name it <b>Add to xairos</b> (Siri uses the name).</li>
  <li>Add <b>Dictate Text</b> (or <b>Ask for Input</b> to type).</li>
  <li>Add <b>Format Date</b>: Current Date, Custom format <code>yyyy-MM-dd</code>.</li>
  <li>Add <b>Get Contents of URL</b>: <code>${esc(endpoint())}</code><br>
    Method <b>POST</b>. Header <code>Authorization</code> = <code>Bearer ${esc(token)}</code>.<br>
    Request Body <b>JSON</b>: <code>text</code> = Dictated Text, <code>date</code> = Formatted Date.</li>
  <li>Add <b>Get Dictionary Value</b> <code>message</code>, then <b>Show Notification</b> (or <b>Speak Text</b>).</li>
</ol>
<p class="hint">Say it like quick add: "Call mum tomorrow 6pm !high #family ^Personal". The phone must reach this server and trust its certificate.</p>`;
