/// <reference path="../pb_data/types.d.ts" />
// xairos sync contract (ROADMAP.md §3) on PocketBase. Loaded with require()
// from xairos.pb.js, because route handlers cannot see file-level code.
// Mirrors src/server/local.ts; test/contract.test.ts runs against both.

const TYPES = ["lists", "tasks", "habits", "focus"];
const SEQ_ID = "globalseq000000";

// ---- Per-field merge: plain-JS copy of src/sync/fields.ts (keep in step) ----
const META = { id: 1, seq: 1, mtime: 1, fm: 1, ownerId: 1, prevListId: 1, inbox: 1 };
const MAP_FIELDS = { habits: ["checks"] };
const isMap = (type, k) => (MAP_FIELDS[type] || []).indexOf(k) >= 0;

function paths(type, o) {
  if (!o) return [];
  const out = [];
  for (const k of Object.keys(o)) {
    if (META[k] || o[k] === undefined) continue;
    if (isMap(type, k) && o[k] && typeof o[k] === "object") for (const sub of Object.keys(o[k])) out.push(k + "." + sub);
    else out.push(k);
  }
  return out;
}
function getPath(type, o, p) {
  const dot = p.indexOf(".");
  if (dot > 0 && isMap(type, p.slice(0, dot))) return (o[p.slice(0, dot)] || {})[p.slice(dot + 1)];
  return o[p];
}
function setPath(type, o, p, v) {
  const dot = p.indexOf(".");
  if (dot > 0 && isMap(type, p.slice(0, dot))) {
    const k = p.slice(0, dot), sub = p.slice(dot + 1);
    const m = Object.assign({}, o[k] || {});
    if (v === undefined) delete m[sub]; else m[sub] = v;
    o[k] = m;
  } else if (v === undefined) delete o[p];
  else o[p] = v;
}
function stampOf(o, p) {
  if (!o) return -1;
  if (!o.fm) return o.mtime || 0;
  const fm = o.fm;
  if (p in fm) return fm[p];
  const dot = p.indexOf(".");
  if (dot > 0 && p.slice(0, dot) in fm) return fm[p.slice(0, dot)];
  return 0;
}
function seedStamps(type, e) {
  const fm = {};
  for (const p of paths(type, e)) fm[p] = e.mtime || 0;
  return fm;
}
function mergeEntity(type, a, b) {
  const out = Object.assign({}, b), fm = {}, all = {};
  for (const p of paths(type, a).concat(paths(type, b), Object.keys(a.fm || {}), Object.keys(b.fm || {}))) all[p] = true;
  for (const p of Object.keys(all)) {
    const sa = stampOf(a, p), sb = stampOf(b, p);
    setPath(type, out, p, getPath(type, sa > sb ? a : b, p));
    fm[p] = Math.max(sa, sb);
  }
  out.fm = fm;
  out.mtime = Math.max(a.mtime || 0, b.mtime || 0);
  return out;
}
/** Server-side change to some fields, stamped so merges see it as the newest. */
function stampServer(type, e, fields) {
  const at = Math.max(Date.now(), (e.mtime || 0) + 1);
  e.fm = Object.assign({}, e.fm || seedStamps(type, e));
  e.mtime = at;
  for (const f of fields) e.fm[f] = at;
}

function openSignup(app) {
  return $os.getenv("XAIROS_OPEN_SIGNUP") === "1" || app.countRecords("users") === 0;
}

const pubUser = (u) => (u ? { id: u.id, name: u.getString("name"), email: u.getString("email") } : null);
const normEmail = (s) => String(s || "").trim().toLowerCase();

function findUser(app, id) { try { return app.findRecordById("users", id); } catch (_) { return null; } }
function findUserByEmail(app, email) { try { return app.findAuthRecordByEmail("users", normEmail(email)); } catch (_) { return null; } }

/** Global seq counter: read once, bump in memory, save once. */
function counter(tx) {
  const rec = tx.findRecordById("counters", SEQ_ID);
  let v = rec.getInt("value");
  return { next: () => ++v, get value() { return v; }, save: () => { rec.set("value", v); tx.save(rec); } };
}

const people = (l) => (l ? [l.ownerId].concat(Object.keys(l.members || {})) : []);
const peopleCol = (l) => "|" + people(l).join("|") + "|";
const canRead = (l, me) => !!l && !l.removed && (l.ownerId === me || !!(l.members || {})[me]);
const canWrite = (l, me) => !!l && !l.removed && (l.ownerId === me || (l.members || {})[me] === "edit");

function dataOf(rec) {
  const raw = rec.get("data");
  return typeof raw === "string" ? JSON.parse(raw) : JSON.parse(toString(raw));
}

/** Load one entity row and its object, or nulls. */
function getRow(tx, type, eid) {
  if (!eid) return { rec: null, obj: null };
  try {
    const rec = tx.findFirstRecordByFilter("entities", "type = {:t} && eid = {:e}", { t: type, e: eid });
    return { rec, obj: dataOf(rec) };
  } catch (_) { return { rec: null, obj: null }; }
}

/** Write an entity: `obj` is the canonical client object (it carries seq). */
function putRow(tx, type, rec, obj) {
  if (!rec) { rec = new Record(tx.findCollectionByNameOrId("entities")); rec.set("type", type); rec.set("eid", obj.id); }
  rec.set("owner", obj.ownerId || "");
  rec.set("listId", type === "tasks" ? obj.listId || "" : "");
  rec.set("prevListId", type === "tasks" ? obj.prevListId || "" : "");
  rec.set("people", type === "lists" ? peopleCol(obj) : "");
  rec.set("seq", obj.seq);
  rec.set("mtime", obj.mtime || 0);
  rec.set("removed", !!obj.removed);
  rec.set("data", obj);
  tx.save(rec);
  return rec;
}

function rows(tx, filter, params) {
  return tx.findRecordsByFilter("entities", filter, "seq", 0, 0, params || {}).filter(Boolean);
}

function addRevoked(tx, user, listId, seq) {
  const r = new Record(tx.findCollectionByNameOrId("revoked"));
  r.set("user", user); r.set("listId", listId); r.set("seq", seq);
  tx.save(r);
}

/** Wake each user's devices: bump their signals row (realtime pushes it). */
function notify(app, users) {
  const col = app.findCollectionByNameOrId("signals");
  const seq = app.findRecordById("counters", SEQ_ID).getInt("value");
  for (const u of users) {
    let r;
    try { r = app.findRecordById("signals", u); } catch (_) { r = new Record(col); r.set("id", u); }
    r.set("seq", seq);
    app.save(r);
  }
}

function signup(app, body) {
  if (!openSignup(app)) throw new ForbiddenError("Sign-up is closed.");
  const name = String(body.name || "").trim(), email = normEmail(body.email), password = String(body.password || "");
  if (!name) throw new BadRequestError("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError("Please enter a valid email.");
  if (password.length < 8) throw new BadRequestError("Password must be at least 8 characters.");
  if (findUserByEmail(app, email)) throw new ApiError(409, "An account with this email already exists.");
  let user;
  app.runInTransaction((tx) => {
    user = new Record(tx.findCollectionByNameOrId("users"));
    user.set("email", email); user.set("name", name); user.setPassword(password);
    tx.save(user);
    const c = counter(tx);
    const inbox = { id: "inbox-" + user.id, name: "Inbox", color: "120,120,130", ownerId: user.id, members: {}, inbox: true, order: 0, mtime: Date.now(), seq: c.next() };
    putRow(tx, "lists", null, inbox);
    c.save();
  });
  notify(app, [user.id]);
  return { token: user.newAuthToken(), user: pubUser(user) };
}

// Per-account lockout: after LOCK_FAILS wrong passwords within LOCK_MS, the email is
// locked for LOCK_MS. Kept in memory (a restart forgets it); the per-IP rate limit
// (migration 1794268800) is the other half. Unknown emails count too, so the
// answer does not tell which emails have accounts.
const LOCK_FAILS = 10, LOCK_MS = 15 * 60000;
const lockKey = (email) => "xairos.fails." + normEmail(email);

function checkLock(app, email) {
  const v = app.store().get(lockKey(email));
  if (v && v.until > Date.now()) {
    const mins = Math.ceil((v.until - Date.now()) / 60000);
    throw new ApiError(429, "Too many wrong passwords. Try again in " + mins + (mins === 1 ? " minute." : " minutes."));
  }
}
/** Drop expired lockout entries once the store holds many (unknown emails would pile up). */
function pruneFails(app, now) {
  try {
    const st = app.store();
    if (st.length() < 1000) return;
    const all = st.getAll();
    for (const k of Object.keys(all)) {
      const v = all[k];
      if (k.indexOf("xairos.fails.") === 0 && v && now - v.first > LOCK_MS && !(v.until > now)) st.remove(k);
    }
  } catch (_) { /* housekeeping only: never fail a login over it */ }
}
function noteFail(app, email) {
  const now = Date.now(), k = lockKey(email);
  pruneFails(app, now);
  let v = app.store().get(k);
  if (!v || now - v.first > LOCK_MS) v = { n: 0, first: now, until: 0 };
  v = { n: v.n + 1, first: v.first, until: v.until };
  if (v.n >= LOCK_FAILS) v.until = now + LOCK_MS;
  app.store().set(k, v);
}
const clearFails = (app, email) => app.store().remove(lockKey(email));

/** Check a password with the lockout. Returns the user record, or throws. */
function checkPassword(app, email, password, wrong) {
  checkLock(app, email);
  const u = findUserByEmail(app, email);
  if (!u || !u.validatePassword(String(password || ""))) { noteFail(app, email); throw new UnauthorizedError(wrong); }
  clearFails(app, email);
  return u;
}

function login(app, body) {
  const u = checkPassword(app, (body || {}).email, (body || {}).password, "Wrong email or password.");
  return { token: u.newAuthToken(), user: pubUser(u) };
}

function pull(app, me, cp) {
  cp = Math.max(0, parseInt(cp, 10) || 0);
  const out = { checkpoint: app.findRecordById("counters", SEQ_ID).getInt("value"), lists: [], tasks: [], habits: [], focus: [], users: [], revoked: [] };
  const needle = "|" + me + "|";
  const visible = rows(app, "type = 'lists' && removed = false && people ~ {:p}", { p: needle }).map(dataOf).filter((l) => canRead(l, me));
  const vis = {};
  for (const l of visible) vis[l.id] = l;
  // Changed lists I can see, plus removed lists I was on (people keeps the last members).
  out.lists = rows(app, "type = 'lists' && seq > {:cp} && people ~ {:p}", { cp, p: needle }).map(dataOf);
  const ids = Object.keys(vis);
  if (ids.length) {
    const params = { cp };
    const ors = ids.map((id, i) => { params["l" + i] = id; return `listId = {:l${i}} || prevListId = {:l${i}}`; });
    for (const rec of rows(app, `type = 'tasks' && seq > {:cp} && (${ors.join(" || ")})`, params)) {
      const t = dataOf(rec);
      if (vis[t.listId]) out.tasks.push(t);
      else if (t.prevListId && vis[t.prevListId]) out.tasks.push({ id: t.id, removed: true });
    }
  }
  for (const type of ["habits", "focus"]) out[type] = rows(app, "type = {:t} && owner = {:me} && seq > {:cp}", { t: type, me, cp }).map(dataOf);
  out.revoked = app.findRecordsByFilter("revoked", "user = {:me} && seq > {:cp}", "seq", 0, 0, { me, cp }).filter(Boolean).map((r) => r.getString("listId"));
  const ppl = {}; ppl[me] = true;
  for (const l of visible) for (const u of people(l)) ppl[u] = true;
  out.users = Object.keys(ppl).map((id) => pubUser(findUser(app, id))).filter(Boolean);
  return out;
}

function push(app, me, ch) {
  ch = ch || {};
  const id2error = {}, affected = {};
  affected[me] = true;
  const touch = (ids) => { for (const u of ids) affected[u] = true; };
  let checkpoint = 0;
  app.runInTransaction((tx) => {
    const c = counter(tx);
    for (const inc of ch.lists || []) {
      const { rec, obj: ex } = getRow(tx, "lists", inc.id);
      if (ex && !canWrite(ex, me)) { id2error[inc.id] = "NO_PERMISSION"; continue; }
      // Per-field merge with the stored copy (no STALE rejection).
      const l = ex ? mergeEntity("lists", ex, inc) : inc;
      const isOwner = !ex || ex.ownerId === me;
      if (l.removed && !(ex && ex.removed) && !isOwner) { id2error[inc.id] = "NO_PERMISSION"; continue; }
      const owner = ex ? ex.ownerId : me;
      let mem = Object.assign({}, isOwner ? l.members || {} : ex.members || {});
      if (ex && ex.inbox) mem = {};
      for (const u of Object.keys(mem)) if (u === owner || ["edit", "view"].indexOf(mem[u]) < 0 || !findUser(tx, u)) delete mem[u];
      const seq = c.next();
      const next = Object.assign({}, l, { ownerId: owner, members: mem, inbox: !!(ex && ex.inbox), seq });
      const before = people(ex), after = people(next);
      for (const u of before) if (after.indexOf(u) < 0) addRevoked(tx, u, l.id, seq);
      const added = after.some((u) => before.indexOf(u) < 0);
      if (next.removed || (added && ex)) {
        for (const trec of rows(tx, "type = 'tasks' && listId = {:l}", { l: l.id })) {
          const t = dataOf(trec);
          if (next.removed && !t.removed) { t.removed = true; stampServer("tasks", t, ["removed"]); }
          t.seq = c.next();
          putRow(tx, "tasks", trec, t);
        }
      }
      // A removed list keeps its people column, so they still receive the tombstone.
      putRow(tx, "lists", rec, next);
      touch(before); touch(after);
    }
    for (const inc of ch.tasks || []) {
      const { rec, obj: ex } = getRow(tx, "tasks", inc.id);
      const t = ex ? mergeEntity("tasks", ex, inc) : inc;
      const L = getRow(tx, "lists", t.listId).obj;
      const fromL = ex ? (ex.listId === t.listId ? L : getRow(tx, "lists", ex.listId).obj) : null;
      if (!canWrite(L, me) || (ex && !canWrite(fromL, me))) { id2error[inc.id] = "NO_PERMISSION"; continue; }
      const prevListId = ex && ex.listId !== t.listId ? ex.listId : (ex && ex.prevListId) || null;
      putRow(tx, "tasks", rec, Object.assign({}, t, { prevListId, seq: c.next() }));
      touch(people(L)); if (fromL) touch(people(fromL));
    }
    for (const type of ["habits", "focus"]) for (const inc of ch[type] || []) {
      const { rec, obj: ex } = getRow(tx, type, inc.id);
      if (ex && ex.ownerId !== me) { id2error[inc.id] = "NO_PERMISSION"; continue; }
      const x = ex ? mergeEntity(type, ex, inc) : inc;
      putRow(tx, type, rec, Object.assign({}, x, { ownerId: me, seq: c.next() }));
    }
    c.save();
    checkpoint = c.value;
  });
  notify(app, Object.keys(affected));
  return { id2error, checkpoint };
}

function leaveList(app, me, listId) {
  let ppl = [];
  app.runInTransaction((tx) => {
    const { rec, obj: l } = getRow(tx, "lists", listId);
    if (!l || !(l.members || {})[me]) throw new NotFoundError("Not a member of this list.");
    ppl = people(l);
    const c = counter(tx);
    delete l.members[me];
    stampServer("lists", l, ["members"]);
    l.seq = c.next();
    putRow(tx, "lists", rec, l);
    addRevoked(tx, me, listId, l.seq);
    c.save();
  });
  notify(app, ppl);
}

// ---- Web Push subscriptions and the notifier feed ----

// Push services a subscription may point at. The notifier POSTs to these URLs,
// so anything else (an internal address) is refused. Tests set XAIROS_PUSH_ANY_HOST=1.
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
const MAX_SUBS_PER_USER = 20;

function pushEndpointOk(url) {
  if (typeof url !== "string" || url.length > 2000) return false;
  if ($os.getenv("XAIROS_PUSH_ANY_HOST") === "1") return /^https?:\/\/[^\s]+$/.test(url);
  const m = /^https:\/\/([A-Za-z0-9.-]+)(:443)?\//.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

const vapidPublic = () => $os.getenv("XAIROS_VAPID_PUBLIC") || "";
const b64uOk = (s, min, max) => typeof s === "string" && s.length >= min && s.length <= max && /^[A-Za-z0-9_-]+=*$/.test(s);

function pushSubscribe(app, me, body) {
  body = body || {};
  const keys = body.keys || {};
  const endpoint = String(body.endpoint || "");
  if (!vapidPublic()) throw new BadRequestError("Background reminders are not set up on this server.");
  if (!pushEndpointOk(endpoint)) throw new BadRequestError("Unsupported push service.");
  if (!b64uOk(keys.p256dh, 80, 100) || !b64uOk(keys.auth, 16, 40)) throw new BadRequestError("Bad subscription keys.");
  const tz = /^[A-Za-z0-9_+\-\/]{1,64}$/.test(String(body.tz || "")) ? String(body.tz) : "";
  const now = Date.now();
  let rec;
  try { rec = app.findFirstRecordByFilter("push_subs", "endpoint = {:e}", { e: endpoint }); } catch (_) { rec = null; }
  // Same browser, new account: it starts over for the new user.
  if (!rec || rec.getString("user") !== me) {
    if (!rec) rec = new Record(app.findCollectionByNameOrId("push_subs"));
    rec.set("user", me); rec.set("endpoint", endpoint); rec.set("since", now);
  }
  rec.set("p256dh", keys.p256dh); rec.set("auth", keys.auth); rec.set("tz", tz); rec.set("seen", now);
  rec.set("weekStart", body.weekStart === 0 ? 0 : 1);
  app.save(rec);
  const mine = app.findRecordsByFilter("push_subs", "user = {:u}", "-seen", 0, 0, { u: me }).filter(Boolean);
  for (const old of mine.slice(MAX_SUBS_PER_USER)) app.delete(old);
}

function pushUnsubscribe(app, me, body) {
  const endpoint = String((body || {}).endpoint || "");
  try { app.delete(app.findFirstRecordByFilter("push_subs", "endpoint = {:e} && user = {:u}", { e: endpoint, u: me })); } catch (_) { /* not there */ }
}

/** Constant-time check of the notifier's shared secret. */
function requireNotifier(given) {
  const want = $os.getenv("XAIROS_NOTIFIER_SECRET") || "";
  given = String(given || "");
  let diff = want.length < 16 || given.length !== want.length ? 1 : 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i % Math.max(1, given.length));
  if (diff) throw new ForbiddenError("Notifier only.");
}

/** Lists, tasks and habits changed after `since`, plus every push subscription. */
function notifierChanges(app, since) {
  since = Math.max(0, parseInt(since, 10) || 0);
  const subs = app.findRecordsByFilter("push_subs", "id != ''", "", 0, 0).filter(Boolean).map((r) => ({
    id: r.id, user: r.getString("user"), endpoint: r.getString("endpoint"), p256dh: r.getString("p256dh"),
    auth: r.getString("auth"), tz: r.getString("tz"), created: r.getInt("since"), weekStart: r.getInt("weekStart"),
  }));
  return {
    checkpoint: app.findRecordById("counters", SEQ_ID).getInt("value"),
    lists: rows(app, "type = 'lists' && seq > {:s}", { s: since }).map(dataOf),
    tasks: rows(app, "type = 'tasks' && seq > {:s}", { s: since }).map(dataOf),
    habits: rows(app, "type = 'habits' && seq > {:s}", { s: since }).map(dataOf),
    subs,
  };
}

/** The push service said these subscriptions no longer exist. */
function pushGone(app, body) {
  for (const e of ((body || {}).endpoints || []).slice(0, 500)) {
    try { app.delete(app.findFirstRecordByFilter("push_subs", "endpoint = {:e}", { e: String(e) })); } catch (_) { /* already gone */ }
  }
}

// ---- Google Calendar ----
// PocketBase does the sign-in and keeps the tokens; the worker
// (server/notifier) writes tasks to the "xairos" calendar and reads events.

const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.app.created", // make the xairos calendar, manage its events
  "https://www.googleapis.com/auth/calendar.readonly",    // read your calendars
].join(" ");

function googleConfig() {
  const clientId = $os.getenv("XAIROS_GOOGLE_CLIENT_ID"), secret = $os.getenv("XAIROS_GOOGLE_CLIENT_SECRET");
  const base = ($os.getenv("XAIROS_PUBLIC_URL") || "").replace(/\/$/, "");
  // XAIROS_GOOGLE_REDIRECT overrides the return address, for when Google refuses this
  // server's address (e.g. http://127.0.0.1:1/). Google then sends the browser to a page
  // that does not load, and the user pastes its address into the app ("manual").
  const override = $os.getenv("XAIROS_GOOGLE_REDIRECT");
  const redirect = override || (base ? base + "/api/xairos/google/callback" : "");
  return {
    ok: !!(clientId && secret && redirect), clientId, secret, redirect,
    manual: !!override && !/\/api\/xairos\/google\/callback$/.test(override),
    authBase: ($os.getenv("XAIROS_GOOGLE_AUTH_BASE") || "https://accounts.google.com").replace(/\/$/, ""),
    oauthBase: ($os.getenv("XAIROS_GOOGLE_OAUTH_BASE") || "https://oauth2.googleapis.com").replace(/\/$/, ""),
  };
}

const form = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])).join("&");

function googleLink(app, me) {
  try { return app.findFirstRecordByFilter("google_links", "user = {:u}", { u: me }); } catch (_) { return null; }
}

/** The user's connection, as the app shows it. */
function googleStatus(app, me) {
  const c = googleConfig(), l = googleLink(app, me);
  const connected = !!(l && l.getString("refresh"));
  return { configured: c.ok, manual: c.manual, connected, email: connected ? l.getString("email") : "", error: connected ? l.getString("error") : "", eventsAt: connected ? l.getInt("eventsAt") : 0 };
}

/** Start a sign-in: a one-time state ties Google's answer to this user. */
function googleAuthUrl(app, me, body) {
  const c = googleConfig();
  if (!c.ok) throw new BadRequestError("Google Calendar is not set up on this server.");
  let l = googleLink(app, me);
  if (!l) { l = new Record(app.findCollectionByNameOrId("google_links")); l.set("user", me); }
  const state = $security.randomString(32);
  l.set("state", state); l.set("stateExp", Date.now() + 15 * 60000);
  const tz = String((body || {}).tz || "");
  if (/^[A-Za-z0-9_+\-\/]{1,64}$/.test(tz)) l.set("tz", tz);
  app.save(l);
  const url = c.authBase + "/o/oauth2/v2/auth?" + form({
    client_id: c.clientId, redirect_uri: c.redirect, response_type: "code", scope: GOOGLE_SCOPES,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return { url, manual: c.manual };
}

/** Swap the code for tokens and store them, for `me`, who must have started this sign-in. */
function googleFinish(app, code, state, me) {
  if (!me) throw new UnauthorizedError("Sign in to xairos first.");
  const c = googleConfig();
  if (!c.ok) throw new BadRequestError("Google Calendar is not set up on this server.");
  if (!code || !state) throw new BadRequestError("Google did not send a sign-in code.");
  let l;
  try { l = app.findFirstRecordByFilter("google_links", "state = {:s}", { s: String(state) }); } catch (_) { l = null; }
  if (!l || l.getInt("stateExp") < Date.now() || l.getString("user") !== me) throw new BadRequestError("This sign-in expired. Start again.");
  const res = $http.send({
    url: c.oauthBase + "/token", method: "POST", timeout: 20,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ code: String(code), client_id: c.clientId, client_secret: c.secret, redirect_uri: c.redirect, grant_type: "authorization_code" }),
  });
  const j = res.json || {};
  if (res.statusCode !== 200 || !j.access_token) throw new BadRequestError("Google refused the sign-in: " + (j.error_description || j.error || res.statusCode));
  // Google sends a refresh token only on first consent (prompt=consent asks every time).
  if (!j.refresh_token && !l.getString("refresh")) throw new BadRequestError("Google sent no refresh token. Remove xairos at myaccount.google.com/permissions and connect again.");
  let email = "";
  try { email = JSON.parse(atobUrl(String(j.id_token || "").split(".")[1] || "")).email || ""; } catch (_) { /* no id token */ }
  if (j.refresh_token) l.set("refresh", j.refresh_token);
  l.set("access", j.access_token); l.set("expires", Date.now() + (j.expires_in || 3600) * 1000 - 60000);
  l.set("email", email); l.set("error", ""); l.set("state", ""); l.set("stateExp", 0);
  app.save(l);
  return l.getString("user");
}

/** base64url → string (goja has no atob). */
function atobUrl(s) {
  const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let bits = 0, n = 0, out = "";
  for (const ch of s.replace(/=+$/, "")) {
    const v = t.indexOf(ch === "+" ? "-" : ch === "/" ? "_" : ch); if (v < 0) continue;
    bits = (bits << 6) | v; n += 6;
    if (n >= 8) { n -= 8; out += String.fromCharCode((bits >> n) & 255); }
  }
  try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
}

function googleDisconnect(app, me) {
  const l = googleLink(app, me); if (!l) return;
  const c = googleConfig(), tok = l.getString("refresh") || l.getString("access");
  if (tok) { try { $http.send({ url: c.oauthBase + "/revoke?token=" + encodeURIComponent(tok), method: "POST", timeout: 10 }); } catch (_) { /* revoked or offline */ } }
  app.delete(l);
}

function googleEvents(app, me) {
  const l = googleLink(app, me);
  if (!l || !l.getString("refresh")) return { events: [], eventsAt: 0 };
  const raw = l.get("events");
  let events = [];
  try { events = typeof raw === "string" ? JSON.parse(raw || "[]") : JSON.parse(toString(raw) || "[]"); } catch (_) { events = []; }
  return { events: events || [], eventsAt: l.getInt("eventsAt") };
}

// Worker side: connected users with tokens, and updates back.
function googleLinks(app) {
  return app.findRecordsByFilter("google_links", "refresh != ''", "", 0, 0).filter(Boolean).map((l) => ({
    user: l.getString("user"), refresh: l.getString("refresh"), access: l.getString("access"), expires: l.getInt("expires"),
    calId: l.getString("calId"), tz: l.getString("tz"), error: l.getString("error"),
  }));
}

function googleUpdate(app, body) {
  body = body || {};
  const l = googleLink(app, String(body.user || "")); if (!l) return;
  for (const k of ["access", "calId", "error"]) if (typeof body[k] === "string") l.set(k, body[k]);
  if (typeof body.expires === "number") l.set("expires", body.expires);
  const changed = Array.isArray(body.events);
  if (changed) { l.set("events", body.events); l.set("eventsAt", Date.now()); }
  app.save(l);
  // The app refreshes its Google events on the next sync signal.
  if (changed) notify(app, [l.getString("user")]);
}

// ---- API tokens and quick add (Apple Shortcuts, step 11) ----

const MAX_TOKENS = 20;
const tokenView = (r) => ({ id: r.id, name: r.getString("name"), prefix: r.getString("prefix"), created: r.getInt("created"), lastUsed: r.getInt("lastUsed") });

function listTokens(app, me) {
  return app.findRecordsByFilter("api_tokens", "user = {:u}", "-created", 0, 0, { u: me }).filter(Boolean).map(tokenView);
}

/** A new token, returned once in full. Format: kai_ + 32 random characters. */
function createToken(app, me, body) {
  const name = String((body || {}).name || "").trim().slice(0, 60) || "Shortcut";
  if (app.countRecords("api_tokens", $dbx.hashExp({ user: me })) >= MAX_TOKENS) throw new BadRequestError("Too many tokens. Revoke one first.");
  const token = "kai_" + $security.randomString(32);
  const r = new Record(app.findCollectionByNameOrId("api_tokens"));
  r.set("user", me); r.set("name", name); r.set("hash", $security.sha256(token)); r.set("prefix", token.slice(0, 8));
  r.set("created", Date.now()); r.set("lastUsed", 0);
  app.save(r);
  return Object.assign(tokenView(r), { token });
}

function revokeToken(app, me, id) {
  try { app.delete(app.findFirstRecordByFilter("api_tokens", "id = {:id} && user = {:u}", { id: String(id), u: me })); }
  catch (_) { throw new NotFoundError("No such token."); }
}

/** The user an API token belongs to (from "Authorization: Bearer kai_…"), or a 401. */
function tokenUser(app, header) {
  const m = /^Bearer\s+(kai_[A-Za-z0-9]{20,64})\s*$/.exec(String(header || ""));
  if (!m) throw new UnauthorizedError("Send your xairos token: Authorization: Bearer kai_…");
  let r;
  try { r = app.findFirstRecordByFilter("api_tokens", "hash = {:h}", { h: $security.sha256(m[1]) }); } catch (_) { r = null; }
  if (!r || !findUser(app, r.getString("user"))) throw new UnauthorizedError("This token is not valid (revoked?).");
  // Coarse last-used time, so a busy Shortcut does not write on every call.
  if (Date.now() - r.getInt("lastUsed") > 60000) { r.set("lastUsed", Date.now()); app.save(r); }
  return r.getString("user");
}

/**
 * Quick add from outside the app: "Buy milk tomorrow 9am !high #home ^Errands".
 * Parsed by the app's own parser (xairos_parse.js, generated from src/parser.ts).
 * `date` (YYYY-MM-DD, the phone's today) anchors "tomorrow"; else the server's date.
 */
function quickAdd(app, me, body) {
  body = body || {};
  const text = String(typeof body === "string" ? body : body.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) throw new BadRequestError("Send the task as text, e.g. {\"text\": \"Buy milk tomorrow 9am\"}.");
  const P = require(`${__hooks}/xairos_parse.js`);
  let today = new Date(); today.setHours(0, 0, 0, 0);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || ""));
  if (dm) today = new Date(+dm[1], +dm[2] - 1, +dm[3]);
  const p = P.parseQuick(text, today);
  if (!p.title) throw new BadRequestError("The task needs a title.");
  // ^List picks one of your lists you can edit (case does not matter); otherwise the Inbox.
  let list = getRow(app, "lists", "inbox-" + me).obj, listName = "Inbox";
  if (p.listName) {
    const want = p.listName.toLowerCase();
    const hit = rows(app, "type = 'lists' && removed = false && people ~ {:p}", { p: "|" + me + "|" }).map(dataOf)
      .find((l) => !l.inbox && canWrite(l, me) && String(l.name).toLowerCase() === want);
    if (hit) { list = hit; listName = hit.name; }
  }
  if (!list) throw new BadRequestError("No list to add to.");
  const now = Date.now();
  const t = {
    id: $security.randomString(16).toLowerCase(), title: p.title, desc: "", listId: list.id, due: p.due, time: p.time,
    priority: p.priority || 0, tags: p.tags || [], items: [], done: false, doneAt: null, deleted: false, created: now, order: now,
    repeat: p.repeat, reminders: p.time ? [0] : [], snooze: null, assignee: null, createdBy: me, mtime: now,
  };
  const res = push(app, me, { tasks: [t] });
  if (res.id2error[t.id]) throw new ForbiddenError("You cannot add to that list.");
  // Said relative to the phone's today, not the server's.
  let when = "";
  if (t.due) {
    const d = t.due.split("-"), days = Math.round((new Date(+d[0], +d[1] - 1, +d[2]) - today) / 864e5);
    when = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : "on " + t.due;
    if (t.time) when += " at " + t.time;
  }
  return { id: t.id, title: t.title, due: t.due, time: t.time, list: listName,
    message: "Added “" + t.title + "”" + (when ? " · " + when : "") + " to " + listName + "." };
}

// ---- Account deletion (GDPR): erase the user and everything only they had ----

/**
 * Needs the password again. Lists the user owns are erased with their tasks
 * (members get a revoke and keep nothing); shared lists they were on lose
 * them as a member, and tasks assigned to them there are unassigned. Habits,
 * focus records, push subscriptions, API tokens and the Google link go too.
 */
function deleteAccount(app, me, body) {
  const self = findUser(app, me);
  if (!self) throw new UnauthorizedError("Session expired. Please sign in again.");
  checkPassword(app, self.getString("email"), (body || {}).password, "Wrong password.");
  googleDisconnect(app, me); // revokes at Google; outside the transaction (network)
  const affected = {};
  app.runInTransaction((tx) => {
    const c = counter(tx), now = Date.now();
    for (const lrec of rows(tx, "type = 'lists' && people ~ {:p}", { p: "|" + me + "|" })) {
      const l = dataOf(lrec);
      for (const x of people(l)) affected[x] = true;
      const trows = rows(tx, "type = 'tasks' && listId = {:l}", { l: l.id });
      if (l.ownerId === me) {
        const seq = c.next();
        if (!l.removed) for (const x of people(l)) if (x !== me) addRevoked(tx, x, l.id, seq);
        // Tombstones keep only ids, so no content outlives the account.
        for (const trec of trows) putRow(tx, "tasks", trec, { id: dataOf(trec).id, listId: l.id, removed: true, mtime: now, seq: c.next() });
        putRow(tx, "lists", lrec, { id: l.id, ownerId: me, members: {}, removed: true, mtime: now, seq });
      } else if (!l.removed && (l.members || {})[me]) {
        delete l.members[me];
        stampServer("lists", l, ["members"]);
        l.seq = c.next();
        putRow(tx, "lists", lrec, l);
        for (const trec of trows) {
          const t = dataOf(trec);
          if (t.assignee !== me) continue;
          t.assignee = null;
          stampServer("tasks", t, ["assignee"]);
          t.seq = c.next();
          putRow(tx, "tasks", trec, t);
        }
      }
    }
    for (const rec of rows(tx, "(type = 'habits' || type = 'focus') && owner = {:me}", { me })) tx.delete(rec);
    for (const col of ["push_subs", "api_tokens", "revoked", "google_links"]) {
      for (const rec of tx.findRecordsByFilter(col, "user = {:u}", "", 0, 0, { u: me }).filter(Boolean)) tx.delete(rec);
    }
    try { tx.delete(tx.findRecordById("signals", me)); } catch (_) { /* never synced */ }
    c.save();
    tx.delete(tx.findRecordById("users", me));
  });
  delete affected[me];
  notify(app, Object.keys(affected));
}

// ---- Trash retention: plain-JS copy of src/lib/trash.ts (keep in step) ----
const TRASH_MS = 30 * 864e5;

/** Delete for good the tasks in Trash for over 30 days. Daily from cron (xairos.pb.js). */
function purgeTrash(app, now) {
  now = now || Date.now();
  const affected = {};
  let n = 0;
  app.runInTransaction((tx) => {
    const c = counter(tx);
    for (const rec of rows(tx, "type = 'tasks' && removed = false")) {
      const t = dataOf(rec), at = stampOf(t, "deleted");
      if (!t.deleted || !(at > 0) || now - at <= TRASH_MS) continue;
      t.removed = true;
      stampServer("tasks", t, ["removed"]);
      t.seq = c.next();
      putRow(tx, "tasks", rec, t);
      for (const u of people(getRow(tx, "lists", t.listId).obj)) affected[u] = true;
      n++;
    }
    if (n) c.save();
  });
  if (n) notify(app, Object.keys(affected));
  return n;
}

// ---- Notification buttons: Complete, Snooze, habit Done ----
// The notifier signs each push with a token for one task or habit and one user
// (server/notifier/actions.ts): base64url JSON {k, i, u, e} + "." + HMAC-SHA256 hex
// over "act1." + body, keyed with XAIROS_NOTIFIER_SECRET. The service worker sends it
// back when a button is tapped, so the button works with no xairos tab open.

const SNOOZE_MS = 15 * 60000;

function verifyAct(app, token) {
  const key = $os.getenv("XAIROS_NOTIFIER_SECRET") || "";
  const m = /^([A-Za-z0-9_-]{10,800})\.([0-9a-f]{64})$/.exec(String(token || ""));
  const bad = () => new UnauthorizedError("This notification has expired. Open xairos instead.");
  if (!m || key.length < 16 || !$security.equal($security.hs256("act1." + m[1], key), m[2])) throw bad();
  let p = null;
  try { p = JSON.parse(atobUrl(m[1])); } catch (_) { p = null; }
  if (!p || typeof p.i !== "string" || typeof p.u !== "string" || !(p.e > Date.now()) || !findUser(app, p.u)) throw bad();
  return p;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function serverToday() { const d = new Date(), z = (n) => (n < 10 ? "0" : "") + n; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); }

/** Body: {token, action: "complete" | "snooze" | "done", today: device's YYYY-MM-DD}. */
function pushAction(app, body) {
  body = body || {};
  const p = verifyAct(app, body.token), action = String(body.action || "");
  const today = ymdOk(body.today) ? String(body.today) : serverToday();
  if (p.k === "habit") {
    if (action !== "done") throw new BadRequestError("Unknown action.");
    const h = getRow(app, "habits", p.i).obj;
    if (!h || h.removed || h.ownerId !== p.u) throw new NotFoundError("This habit no longer exists.");
    const g = Math.max(1, Math.floor(h.goal || 1)), v = (h.checks || {})[today];
    const n = v === true ? g : typeof v === "number" ? v : 0;
    if (g === 1 && n) return { ok: true, message: "Already done today." };
    const x = clone(h);
    x.checks = Object.assign({}, x.checks || {});
    x.checks[today] = g === 1 ? true : Math.min(999, n + 1);
    stampServer("habits", x, ["checks." + today]);
    push(app, p.u, { habits: [x] });
    return { ok: true, message: g === 1 ? "Done." : (n + 1) + "/" + g + " today." };
  }
  if (p.k !== "task") throw new BadRequestError("Unknown action.");
  const t = getRow(app, "tasks", p.i).obj;
  if (!t || t.removed || t.deleted) throw new NotFoundError("This task no longer exists.");
  const out = [];
  let message;
  if (action === "snooze") {
    const x = clone(t);
    x.snooze = Date.now() + SNOOZE_MS;
    stampServer("tasks", x, ["snooze"]);
    out.push(x); message = "Snoozed for 15 minutes.";
  } else if (action === "complete") {
    // The token names the due it was sent for: a repeating task that moved on was completed already.
    if (t.done || ("d" in p && t.due !== p.d)) return { ok: true, message: "Already completed." };
    const x = clone(t), now = Date.now();
    const r = t.repeat && t.due ? require(`${__hooks}/xairos_parse.js`).advanceRepeat(t.repeat, t.due, today) : null;
    if (!r || r.finished) {
      Object.assign(x, { done: true, doneAt: now, snooze: null });
      stampServer("tasks", x, ["done", "doneAt", "snooze"]);
      message = r ? "Completed, last occurrence." : "Completed.";
    } else {
      // Like the app (src/actions.ts): log a done copy, move the task to its next date.
      const copy = Object.assign(clone(t), { id: $security.randomString(16).toLowerCase(), done: true, doneAt: now, repeat: null, reminders: [], snooze: null, repeatOf: t.id, created: now, order: now, mtime: now });
      delete copy.fm; delete copy.seq; delete copy.prevListId;
      out.push(copy);
      Object.assign(x, { due: r.next, snooze: null, items: (t.items || []).map((i) => Object.assign({}, i, { done: false })), repeat: Object.assign({}, t.repeat, { done: (t.repeat.done || 0) + 1 }) });
      stampServer("tasks", x, ["due", "snooze", "items", "repeat"]);
      message = "Completed. Next: " + r.next + ".";
    }
    out.push(x);
  } else throw new BadRequestError("Unknown action.");
  const res = push(app, p.u, { tasks: out });
  if (Object.keys(res.id2error).length) throw new ForbiddenError("You can no longer change this task.");
  return { ok: true, message };
}

// ---- Habit check-in with an API token (Apple Shortcuts). Mirrors src/server/local.ts. ----

/** Your live habits for a Shortcuts picker: [{id, name}] in habit order. */
function habitList(app, me) {
  return rows(app, "type = 'habits' && owner = {:me} && removed = false", { me }).map(dataOf)
    .sort((a, b) => (a.order || 0) - (b.order || 0)).map((h) => ({ id: h.id, name: h.name }));
}

/**
 * The day's check-ins after an action. "done": up to the goal (no change once
 * met). "+1": one more, past the goal too. "undo": one fewer (a goal of 1
 * clears the day). Keep in step with habitStep in src/server/local.ts.
 */
function habitStep(goal, n, action) {
  if (action === "done") return Math.max(n, goal);
  if (action === "+1") return goal === 1 ? Math.max(n, 1) : Math.min(999, n + 1);
  if (action === "undo") return goal === 1 ? 0 : Math.max(0, n - 1);
  return -1;
}

/** Body: {action: "done" | "+1" | "undo", today?: the phone's YYYY-MM-DD}. Same merge path as the push actions. */
function habitCheck(app, me, id, body) {
  body = body || {};
  const action = String(body.action || "");
  if (body.today !== undefined && body.today !== null && !ymdOk(body.today)) throw new BadRequestError("Send today as YYYY-MM-DD.");
  const today = ymdOk(body.today) ? String(body.today) : serverToday();
  const h = getRow(app, "habits", String(id || "")).obj;
  if (!h || h.removed || h.ownerId !== me) throw new NotFoundError("No such habit.");
  const g = Math.max(1, Math.floor(h.goal || 1)), v = (h.checks || {})[today];
  const n = v === true ? g : typeof v === "number" ? v : 0;
  const next = habitStep(g, n, action);
  if (next < 0) throw new BadRequestError("Unknown action. Use done, +1 or undo.");
  const res = { id: h.id, name: h.name, day: today, count: next, goal: g, done: next >= g };
  if (next === n) return Object.assign(res, { message: action === "undo" ? "Nothing to undo." : "Already done today." });
  const x = clone(h);
  x.checks = Object.assign({}, x.checks || {});
  if (!next) delete x.checks[today]; else x.checks[today] = g === 1 && next === 1 ? true : next;
  stampServer("habits", x, ["checks." + today]);
  push(app, me, { habits: [x] });
  const message = action === "undo" && !next ? "Undone." : g === 1 || (action === "done" && next === g) ? "Done." : next + "/" + g + " today.";
  return Object.assign(res, { message });
}

module.exports = {
  signup, login, pull, push, leaveList, findUserByEmail, pubUser,
  vapidPublic, pushSubscribe, pushUnsubscribe, requireNotifier, notifierChanges, pushGone,
  googleConfig, googleStatus, googleAuthUrl, googleFinish, googleDisconnect, googleEvents, googleLinks, googleUpdate,
  listTokens, createToken, revokeToken, tokenUser, quickAdd, habitList, habitCheck,
  pushAction, purgeTrash, deleteAccount,
};
