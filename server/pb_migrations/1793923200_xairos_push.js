/// <reference path="../pb_data/types.d.ts" />
// Web Push subscriptions (one row per browser/device). Locked: only the
// routes in pb_hooks/xairos.pb.js read and write them.
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "push_subs",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "text", required: true, max: 32 },
      { name: "endpoint", type: "text", required: true, max: 2000 },
      { name: "p256dh", type: "text", required: true, max: 200 },
      { name: "auth", type: "text", required: true, max: 100 },
      { name: "tz", type: "text", max: 64 },             // IANA zone of the device, for floating times
      { name: "since", type: "number", onlyInt: true },  // ms when this device subscribed
      { name: "seen", type: "number", onlyInt: true },   // ms when the app last refreshed it
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_push_subs_endpoint ON push_subs (endpoint)",
      "CREATE INDEX idx_push_subs_user ON push_subs (user)",
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("push_subs")); } catch (_) { /* already gone */ }
});
