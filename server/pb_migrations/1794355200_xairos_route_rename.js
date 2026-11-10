/// <reference path="../pb_data/types.d.ts" />
// The API moved to /api/xairos/* when the app was renamed. Rate-limit rules are
// stored in the settings by 1794268800_xairos_rate_limits.js; on a server that ran
// it before the rename they still name the old prefix. Replace those with the
// current rules. On a new install this changes nothing.
const RULES = [
  { label: "POST /api/xairos/login", maxRequests: 30, duration: 60, audience: "" },
  { label: "POST /api/xairos/account/delete", maxRequests: 5, duration: 60, audience: "" },
  { label: "POST /api/xairos/push/action", maxRequests: 60, duration: 60, audience: "" },
];
const OURS = /^POST \/api\/[a-z]+\/(login|account\/delete|push\/action)$/;

migrate((app) => {
  const s = app.settings();
  const kept = s.rateLimits.rules.filter((r) => !OURS.test(r.label));
  s.rateLimits.rules = kept.concat(RULES);
  app.save(s);
}, (_app) => {
  // Nothing to undo: the old prefix is gone from the hooks.
});
