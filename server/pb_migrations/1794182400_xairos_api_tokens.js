/// <reference path="../pb_data/types.d.ts" />
// Personal API tokens (Apple Shortcuts quick add). Only a SHA-256 of each
// token is stored; the token itself is shown once when created.
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "api_tokens",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "text", required: true, max: 32 },
      { name: "name", type: "text", max: 60 },
      { name: "hash", type: "text", required: true, max: 64 },
      { name: "prefix", type: "text", max: 16 },              // first characters, to tell tokens apart
      { name: "created", type: "number", onlyInt: true },
      { name: "lastUsed", type: "number", onlyInt: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_api_tokens_hash ON api_tokens (hash)",
      "CREATE INDEX idx_api_tokens_user ON api_tokens (user)",
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("api_tokens")); } catch (_) { /* already gone */ }
});
