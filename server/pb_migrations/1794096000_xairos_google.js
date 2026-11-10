/// <reference path="../pb_data/types.d.ts" />
// Google Calendar connection, one row per user. Locked: only the routes in
// pb_hooks read and write it. Holds the OAuth refresh token in plain text
// (the database is private to the server; see README "Google Calendar").
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "google_links",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "text", required: true, max: 32 },
      { name: "email", type: "text", max: 320 },
      { name: "refresh", type: "text", max: 2000 },
      { name: "access", type: "text", max: 4000 },
      { name: "expires", type: "number", onlyInt: true },   // ms
      { name: "calId", type: "text", max: 500 },             // the "xairos" calendar
      { name: "tz", type: "text", max: 64 },                 // zone for floating task times
      { name: "state", type: "text", max: 64 },              // pending sign-in
      { name: "stateExp", type: "number", onlyInt: true },
      { name: "error", type: "text", max: 500 },
      { name: "events", type: "json", maxSize: 5000000 },    // events read from Google, for the app
      { name: "eventsAt", type: "number", onlyInt: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_google_links_user ON google_links (user)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("google_links")); } catch (_) { /* already gone */ }
});
