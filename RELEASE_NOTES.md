# Daily Life v0.6.0

_27 October 2026_

## New: Planner calendar

- **Planner now opens on a Calendar**, with **To do** and **Events** as tabs beside it (same header, breadcrumb and pills as Budget). The old Planner hub screen is gone; the bottom-nav Planner tab, Home tile and dashboard links all land on the calendar.
- **Month view**: a grid with coloured dots (purple events, red tasks, green meals), tap a day to see its agenda below. **Week view**: seven days; on a phone a list, on a tablet seven columns across the screen (the tablet default).
- Shows **events** (Google Calendar, read only), **tasks due** and **planned meals**. Chips switch each layer on or off.
- Navigate with the arrows and **Today**. Month and Week toggle sits next to them.
- **Add from a day**: "+ Add" (month) or "+" on a day (week) opens a small sheet: **Add a task** and **Add a meal** open the existing forms with that day filled in and you stay on the calendar; **Add an event** opens Google Calendar on that day.
- Tap a task or meal to edit it with the same forms. Tick a task's circle to change its status. Overdue tasks are marked.
- Switching between the Calendar, To do and Events tabs replaces the history entry, so Back leaves Planner (same as Budget).

## Worker

- `GET /api/events` accepts an optional `from=YYYY-MM-DD` (with `days`, up to 60) so the calendar can show any month or week, including past days. Without it the Events tab behaves as before. A bad date returns a 400. No extra Airtable calls.

## User action

- Deploy `worker.js`, then publish the app files (`index.html` bumps `?v=0.6.0`). This release includes v0.5.0 (tablet), so deploy both together if v0.5.0 is not live yet. `icons.js` is the v0.5.0 one.

## Notes

- Meals before about two weeks ago are not loaded (the meal plan only reads from 14 days back), so older months show events and tasks only.
- Events are fetched for the visible month or week each time you move, served from the Worker's calendar cache (5 minutes).
- Tasks without a due date are not on the calendar; they stay in To do.
- No Airtable schema changes.
- Files changed: `index.html`, `app.js`, `styles.css`, `navigation.js`, `worker.js`. `app.test.mjs` extended (calendar grid and week label).

# Daily Life v0.5.0

_25 October 2026_

## New: tablet layout (screens 900px wide and up)

- **Side rail** replaces the bottom tabs: Home, Meals, Planner, Budget, More, with **Documents** (opens Drive) at the bottom. Phones are unchanged.
- **Home is now a dashboard**: a large clock and date, then **Today** (events, tasks due, overdue alert), **Tonight's dinner** (photo, View recipe, also-today meals, next 3 days), **Budget** (spent, status chip, pace warning, "updated" date) and **Coming up** (events for the next 6 days). Each panel title links to its module.
- **Cooking view**: opening a recipe on a tablet shows ingredients and method side by side, with large tick targets, a **servings stepper** that rescales the quantities, **Start N min timer** buttons on any step that mentions a time, and a timers bar. Servings changes are not saved.
- **Focus mode**: one step at a time in large type, with the ingredients for that step, a timer for it, Back and Next. Next ticks the step off. Esc or Exit focus leaves it.
- **Screen stays awake** on the Home dashboard and in the recipe/cooking view (plug the tablet in). It is released everywhere else.
- Other screens (To do, Events, Meal plan, Recipes, Budget tabs, Settings) get the rail and a wider column. Forms open as centred dialogs.
- Rotating or resizing across 900px re-draws the current screen.

## Worker

- `/api/budget` also returns `lastTransaction` (the latest transaction date loaded), shown as "updated 24 Oct" on the dashboard.

## User action

- Deploy `worker.js`, then publish the app files (`index.html` bumps `?v=0.5.0`). Replace `icons.js` too (adds a minus icon).
- On the tablet: open the site in the browser and **Add to Home Screen**. Wake lock needs HTTPS and a recent iPadOS 16.4+ or Android Chrome.

## Notes

- Timers live in memory: they keep running while you browse the app but are lost on reload or if the tablet restarts.
- A step with several times ("brown for 5 minutes ... simmer for 20 minutes") gets a button for each. Hours and minutes written together ("1 hour 30 minutes") give two timers.
- Quantities scale as decimals (2.5 tbsp), not fractions.
- No Airtable schema changes. `navigation.js` unchanged.
- Files changed: `index.html`, `app.js`, `styles.css`, `icons.js`, `worker.js`. New: `app.test.mjs` (run `node app.test.mjs`).

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

