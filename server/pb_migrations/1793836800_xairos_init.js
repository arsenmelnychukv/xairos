/// <reference path="../pb_data/types.d.ts" />
// xairos schema. All sync collections are locked (null rules): only the
// routes in pb_hooks/xairos.pb.js read and write them.
migrate((app) => {
  const locked = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };

  // One row per synced entity. `data` is the client's whole object.
  app.save(new Collection({
    type: "base", name: "entities", ...locked,
    fields: [
      { name: "type", type: "select", required: true, maxSelect: 1, values: ["lists", "tasks", "habits", "focus"] },
      { name: "eid", type: "text", required: true, max: 64 },
      { name: "owner", type: "text", max: 32 },        // lists, habits, focus
      { name: "listId", type: "text", max: 64 },       // tasks
      { name: "prevListId", type: "text", max: 64 },   // tasks moved out of a list
      { name: "people", type: "text", max: 20000 },    // lists: "|owner|member|…|"
      { name: "seq", type: "number", onlyInt: true },
      { name: "mtime", type: "number", onlyInt: true },
      { name: "removed", type: "bool" },
      { name: "data", type: "json", maxSize: 2000000 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_entities_type_eid ON entities (type, eid)",
      "CREATE INDEX idx_entities_seq ON entities (seq)",
      "CREATE INDEX idx_entities_list ON entities (listId)",
    ],
  }));

  // A user lost access to a list at this seq.
  app.save(new Collection({
    type: "base", name: "revoked", ...locked,
    fields: [
      { name: "user", type: "text", required: true, max: 32 },
      { name: "listId", type: "text", required: true, max: 64 },
      { name: "seq", type: "number", onlyInt: true },
    ],
    indexes: ["CREATE INDEX idx_revoked_user_seq ON revoked (user, seq)"],
  }));

  // Global monotonic sequence: one row.
  const counters = new Collection({
    type: "base", name: "counters", ...locked,
    fields: [{ name: "value", type: "number", onlyInt: true }],
  });
  app.save(counters);
  const seq = new Record(counters);
  seq.set("id", "globalseq000000");
  seq.set("value", 0);
  app.save(seq);

  // Realtime "needSync": one row per user (id = user id). Each user can
  // subscribe only to their own row; the server bumps `seq` to wake them.
  app.save(new Collection({
    type: "base", name: "signals",
    listRule: "id = @request.auth.id", viewRule: "id = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [{ name: "seq", type: "number", onlyInt: true }],
  }));

  // Closed sign-up: accounts are created through /api/xairos/signup only.
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  users.authToken.duration = 90 * 24 * 3600;
  app.save(users);
}, (app) => {
  for (const name of ["signals", "counters", "revoked", "entities"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) { /* already gone */ }
  }
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "";
  app.save(users);
});
