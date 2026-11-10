/**
 * What PocketBase's hooks borrow from the app, bundled for goja by
 * vite.hooks.config.ts into server/pb_hooks/xairos_parse.js:
 * - the quick-add parser, so the server parses "Buy milk tomorrow 9am" like the app;
 * - advanceRepeat, so "Complete" on a notification moves a repeating task like the app does.
 */
export { parseQuick } from '../parser';
export { advanceRepeat } from '../recurrence';
