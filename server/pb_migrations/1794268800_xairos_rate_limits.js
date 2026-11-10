/// <reference path="../pb_data/types.d.ts" />
// Brute-force protection for passwords (ROADMAP.md §1, P0 auth).
// - Per IP: PocketBase's rate limiter on the routes that check a password. Behind
//   Caddy every request comes from 127.0.0.1, so the client IP is read from
//   X-Forwarded-For (rightmost entry: the one Caddy added). PocketBase listens on
//   127.0.0.1 only, so nobody can reach it with a forged header.
// - Per account: xairos_lib.js locks an email after repeated wrong passwords.
// - PocketBase's own password login (/api/collections/users/auth-with-password)
//   is turned off: it would skip both. xairos signs in through /api/xairos/login.
const RULES = [
  { label: "POST /api/xairos/login", maxRequests: 30, duration: 60, audience: "" },
  { label: "POST /api/xairos/account/delete", maxRequests: 5, duration: 60, audience: "" },
  { label: "POST /api/xairos/push/action", maxRequests: 60, duration: 60, audience: "" },
];

migrate((app) => {
  const s = app.settings();
  const ours = RULES.map((r) => r.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => ours.indexOf(r.label) < 0).concat(RULES);
  s.rateLimits.enabled = true;
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;
  app.save(s);

  const users = app.findCollectionByNameOrId("users");
  users.passwordAuth.enabled = false;
  app.save(users);
}, (app) => {
  const s = app.settings();
  const ours = RULES.map((r) => r.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => ours.indexOf(r.label) < 0);
  s.trustedProxy.headers = [];
  app.save(s);
  const users = app.findCollectionByNameOrId("users");
  users.passwordAuth.enabled = true;
  app.save(users);
});
