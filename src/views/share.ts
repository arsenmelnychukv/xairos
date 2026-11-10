import type { List, Role } from '../types';
import { $, esc } from '../lib/util';
import { S, avatarHtml, isOwner, listById, me, server, sess, upd, userOf } from '../store';
import { I } from '../ui/icons';
import { popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { render } from '../app';

export function shareDialog(anchor: Element, id: string) {
  const l = listById(id); if (!l) return;
  const owner = isOwner(id);
  const roleSel = (u: string, role: Role) => owner
    ? `<select data-role="${u}"><option value="edit" ${role === 'edit' ? 'selected' : ''}>Can edit</option><option value="view" ${role === 'view' ? 'selected' : ''}>Can view</option></select><button class="icon-btn" data-rm="${u}" aria-label="Remove">${I.close}</button>`
    : `<span style="font-size:12px;color:var(--t3)">${role === 'edit' ? 'Can edit' : 'Can view'}</span>`;
  const ownerU = userOf(l.ownerId, 'Owner');
  const p = popover(anchor, `
    <h4>Share “${esc(l.name)}”</h4>
    ${owner ? `<div class="invite"><input id="sh-email" type="email" placeholder="Invite by email"><select id="sh-role"><option value="edit">Can edit</option><option value="view">Can view</option></select><button class="btn pri" id="sh-go">Invite</button></div><div class="err" id="sh-err"></div>` : ''}
    <div class="member">${avatarHtml(ownerU)}<div class="who"><div>${esc(ownerU.name)}${l.ownerId === me() ? ' (you)' : ''}</div><div>${esc(ownerU.email || '')}</div></div><span style="font-size:12px;color:var(--t3)">Owner</span></div>
    ${Object.entries(l.members || {}).map(([u, role]) => { const usr = S.users[u] || { id: u, name: 'Unknown user', email: '' }; return `<div class="member">${avatarHtml(usr)}<div class="who"><div>${esc(usr.name)}${u === me() ? ' (you)' : ''}</div><div>${esc(usr.email || '')}</div></div>${roleSel(u, role)}</div>`; }).join('')}
    <div class="note">${owner ? 'Invitees must already have a xairos account.' : 'Only the owner can change sharing.'}</div>`, 360);
  if (!owner) return;
  const save = (members: List['members']) => { upd('lists', { ...S.lists[id]!, members }); render(); shareDialog(anchor, id); };
  const invite = async () => {
    const email = $<HTMLInputElement>('#sh-email', p).value.trim(), role = $<HTMLSelectElement>('#sh-role', p).value as Role, err = $('#sh-err', p);
    err.textContent = '';
    if (!email) return;
    if (email.toLowerCase() === sess().user.email) { err.textContent = 'That is you.'; return; }
    try {
      const u = await server.findUser(sess().token, email);
      if (!u) { err.textContent = 'No xairos account with that email.'; return; }
      S.users[u.id] = u;
      save({ ...(S.lists[id]!.members || {}), [u.id]: role });
      toast(`Shared with ${u.name}`);
    } catch (e) { err.textContent = (e as Error).message; }
  };
  $('#sh-go', p).onclick = invite;
  $('#sh-email', p).onkeydown = e => { if (e.key === 'Enter') invite(); };
  p.querySelectorAll<HTMLSelectElement>('[data-role]').forEach(s => s.onchange = () => save({ ...S.lists[id]!.members, [s.dataset.role!]: s.value as Role }));
  p.querySelectorAll<HTMLElement>('[data-rm]').forEach(b => b.onclick = () => { const m = { ...S.lists[id]!.members }; delete m[b.dataset.rm!]; save(m); });
  $('#sh-email', p).focus();
}
