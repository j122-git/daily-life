# Daily Life — v0.2.1

Daily Life family web app. This release is focused on the To-do module.

### To-do behaviour
- All / Today / Upcoming / Done filters
- To do / In progress / Done status
- Airtable-driven Category and Status selectors
- Long UK date format
- Due-date sorting, newest first by default
- Add / edit / delete task form

### API
The frontend uses the configured Cloudflare Worker. The Worker exposes `/api/todo-options` to read the Category and Status single-select choices from the Airtable base schema.

### Rollback
The previous known-good baseline is `v0.1.0`.
