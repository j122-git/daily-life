# Daily Life v0.4.6

_22 October 2026_

## Cleanup (Worker only, no visible change)

- The request router is now a small table instead of a long chain of checks.
- To-do and meal-plan create, update and delete share one set of helpers (read the body, call Airtable, clear the cache) instead of six near-identical copies.
- `worker.js` is about 7 KB and 650 lines smaller. The rest is real logic (recipe import, calendar feed, budget, roll-up), so there is little more to shave without changing behaviour.
- Checked by running the old and new Worker against the same fake Airtable (85 requests: every route, bad input, Airtable failures, cache clearing). Responses and Airtable requests were identical.
- One tiny difference: a request body of `null` to the to-do endpoints now gets a normal 400 error instead of a 500.

## User action

- Deploy `worker.js`. The app files are unchanged, so no `?v=` bump is needed.

## Notes

- No Airtable schema changes.
- Files changed: `worker.js`.

