/// <reference path="../pb_data/types.d.ts" />
// xairos API routes (ROADMAP.md §3). Logic lives in xairos_lib.js.

routerAdd("POST", "/api/xairos/signup", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.signup(e.app, e.requestInfo().body));
});

routerAdd("POST", "/api/xairos/login", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.login(e.app, e.requestInfo().body));
});

routerAdd("GET", "/api/xairos/sync", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.pull(e.app, e.auth.id, e.request.url.query().get("checkpoint")));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/sync", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.push(e.app, e.auth.id, e.requestInfo().body));
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/xairos/users", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  const u = k.findUserByEmail(e.app, e.request.url.query().get("email"));
  if (!u) throw new NotFoundError("No xairos account with that email.");
  return e.json(200, k.pubUser(u));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/lists/{id}/leave", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.leaveList(e.app, e.auth.id, e.request.pathValue("id"));
  return e.noContent(204);
}, $apis.requireAuth("users"));

// Delete the signed-in account for good. Body: {"password": "..."}.
routerAdd("POST", "/api/xairos/account/delete", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.deleteAccount(e.app, e.auth.id, e.requestInfo().body);
  return e.noContent(204);
}, $apis.requireAuth("users"));

// ---- Web Push (step 6). The notifier sidecar sends; PocketBase stores subscriptions. ----

routerAdd("GET", "/api/xairos/push/key", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, { publicKey: k.vapidPublic() });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/push/subscribe", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.pushSubscribe(e.app, e.auth.id, e.requestInfo().body);
  return e.noContent(204);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/push/unsubscribe", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.pushUnsubscribe(e.app, e.auth.id, e.requestInfo().body);
  return e.noContent(204);
}, $apis.requireAuth("users"));

// A button on a reminder notification. No session: the signed token in the body is the proof.
routerAdd("POST", "/api/xairos/push/action", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.pushAction(e.app, e.requestInfo().body));
});

// Notifier-only routes: a shared secret in X-xairos-Secret, no user token.
routerAdd("GET", "/api/xairos/internal/changes", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.requireNotifier(e.request.header.get("X-xairos-Secret"));
  return e.json(200, k.notifierChanges(e.app, e.request.url.query().get("since")));
});

routerAdd("POST", "/api/xairos/internal/push/gone", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.requireNotifier(e.request.header.get("X-xairos-Secret"));
  k.pushGone(e.app, e.requestInfo().body);
  return e.noContent(204);
});

// ---- Google Calendar (step 10). The worker syncs; these routes connect. ----

routerAdd("GET", "/api/xairos/google", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.googleStatus(e.app, e.auth.id));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/google/auth-url", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.googleAuthUrl(e.app, e.auth.id, e.requestInfo().body));
}, $apis.requireAuth("users"));

// Google sends the browser back here. This request has no session, so it does not finish
// the sign-in: it hands code and state to the app (in the fragment, which never reaches a
// server), and the app finishes with its session. The state must belong to that user, so a
// sign-in link someone else started cannot attach your Google account to their xairos.
routerAdd("GET", "/api/xairos/google/callback", (e) => {
  const q = e.request.url.query();
  if (q.get("error")) return e.redirect(302, "/#/calendar?google_error=" + encodeURIComponent(q.get("error")));
  return e.redirect(302, "/#/calendar?google_code=" + encodeURIComponent(q.get("code")) + "&google_state=" + encodeURIComponent(q.get("state")));
});

// The app finishes the sign-in: from the callback above, or from an address the user pasted.
routerAdd("POST", "/api/xairos/google/finish", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  const b = e.requestInfo().body || {};
  k.googleFinish(e.app, b.code, b.state, e.auth.id);
  return e.json(200, k.googleStatus(e.app, e.auth.id));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/google/disconnect", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.googleDisconnect(e.app, e.auth.id);
  return e.noContent(204);
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/xairos/google/events", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.googleEvents(e.app, e.auth.id));
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/xairos/internal/google/links", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.requireNotifier(e.request.header.get("X-xairos-Secret"));
  return e.json(200, k.googleLinks(e.app));
});

routerAdd("POST", "/api/xairos/internal/google/update", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.requireNotifier(e.request.header.get("X-xairos-Secret"));
  k.googleUpdate(e.app, e.requestInfo().body);
  return e.noContent(204);
});

// ---- API tokens and quick add (step 11) ----

routerAdd("GET", "/api/xairos/tokens", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.listTokens(e.app, e.auth.id));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/xairos/tokens", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.createToken(e.app, e.auth.id, e.requestInfo().body));
}, $apis.requireAuth("users"));

routerAdd("DELETE", "/api/xairos/tokens/{id}", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.revokeToken(e.app, e.auth.id, e.request.pathValue("id"));
  return e.noContent(204);
}, $apis.requireAuth("users"));

// Quick add with an API token (Apple Shortcuts, scripts). Body: {"text": "...", "date": "YYYY-MM-DD"}.
routerAdd("POST", "/api/xairos/quick-add", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  const me = k.tokenUser(e.app, e.request.header.get("Authorization"));
  return e.json(200, k.quickAdd(e.app, me, e.requestInfo().body));
});

// Habits for a Shortcuts picker, and a check-in, with an API token. Body: {"action": "done"|"+1"|"undo", "today": "YYYY-MM-DD"}.
routerAdd("GET", "/api/xairos/habits", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  return e.json(200, k.habitList(e.app, k.tokenUser(e.app, e.request.header.get("Authorization"))));
});

routerAdd("POST", "/api/xairos/habits/{id}/check", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  const me = k.tokenUser(e.app, e.request.header.get("Authorization"));
  return e.json(200, k.habitCheck(e.app, me, e.request.pathValue("id"), e.requestInfo().body));
});

// ---- Trash retention: tasks in Trash for 30 days are deleted for good ----

cronAdd("xairos_trash", "17 4 * * *", () => {
  const k = require(`${__hooks}/xairos_lib.js`);
  const n = k.purgeTrash($app);
  if (n) $app.logger().info("xairos: emptied old Trash", "tasks", n);
});

// The same on demand (tests, or by hand). `now` lets a test pretend it is later.
routerAdd("POST", "/api/xairos/internal/purge-trash", (e) => {
  const k = require(`${__hooks}/xairos_lib.js`);
  k.requireNotifier(e.request.header.get("X-xairos-Secret"));
  return e.json(200, { purged: k.purgeTrash(e.app, Number((e.requestInfo().body || {}).now) || 0) });
});
