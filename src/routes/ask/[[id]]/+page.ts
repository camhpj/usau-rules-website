// Auth-gated, per-user, per-conversation-id page — same reasoning as `/me`
// (src/routes/me/+page.server.ts): must not be prerendered. `[[id]]` matches both
// `/ask` and `/ask/<id>`, so this override covers the whole tree. Without it, this
// route inherits `prerender = true` from the root layout; since ids aren't
// enumerable at build time, only the bare `/ask` entry gets prerendered and the
// route is dropped from the server's dynamic manifest entirely — any hard
// navigation to a concrete `/ask/<id>` (valid or not) 404s.
export const prerender = false;
