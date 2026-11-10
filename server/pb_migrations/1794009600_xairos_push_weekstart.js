/// <reference path="../pb_data/types.d.ts" />
// The device's week start (1 Monday, 0 Sunday), for weekly habit reminders.
migrate((app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.add(new NumberField({ name: "weekStart", onlyInt: true, min: 0, max: 6 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.removeByName("weekStart");
  app.save(c);
});
