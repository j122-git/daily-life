# Daily Life v0.3.5

_14 October 2026_

## New: add a recipe from a link

- **+** button on the Recipes screen. Paste a recipe link and tap **Fetch recipe**.
- The Worker reads the recipe data embedded in the page (title, image, servings, time, cuisine, ingredients, method). Plain JavaScript, no external service.
- **Editable preview** before anything is saved: title, servings, time (mins), cuisine (your existing cuisines), ingredient lines (quantity, unit, name, preparation), method (one step per line). Ingredients not yet in your Ingredients table carry a **New** badge.
- **Save** creates the recipe, any new Ingredients, and one Ingredients Quantities row per line, then opens the recipe. Quantity (base) / Unit (base) are filled in for the future shopping list (tsp, tbsp and cups become ml; oz and lb become g; kg and l scale to g and ml).
- If the link is already in your recipes you are warned and can open it or import anyway.
- If a site can't be read (no recipe data, blocks bots, or is slow) you get an error and nothing is saved.
- Costs about 5 Airtable calls per import (visible under Settings > API usage).

## Worker

- New endpoints `POST /api/import/preview` (no Airtable writes) and `POST /api/import/save`.
- Safety: only http/https links to public sites (localhost, private and internal addresses are blocked, including after redirects); pages are capped at 2 MB and 8 seconds.
- Ingredient matching ignores case, plurals and words such as "large" or "fresh". If Airtable rejects the image or cuisine, the recipe is saved without them and you are told.

## Notes

- Ingredient parsing is rule-based and will not be perfect (e.g. "Juice of 1 lemon" stays one line). That is what the preview is for.
- A range such as "2-3 tbsp" uses the first number.
- Field names checked against the Airtable base on 14 October 2026.
- Fields written: Recipes `Name`, `link`, `Recipe text`, `Default servings`, `Cooking time (mins)`, `Cuisine`, `Image`, `Ingredients`, `Ingredients extracted`; Ingredients `Name`; Ingredients Quantities `Name` (e.g. "garlic 3 clove"), `Recipe`, `Ingredient`, `Original Quantity`, `Original Unit`, `Quantity (base)`, `Unit (base)`, `Preparation`, `Optional?`.
- No schema changes. `icons.js` and `navigation.js` untouched.
- Files changed: `worker.js`, `app.js`, `styles.css`.

# Daily Life v0.3.4

_14 October 2026_

## New: Settings hub

- The key icon is now a **cog**, shown on the Home header only. Other screens no longer carry an icon in the header. The **More** tab in the bottom nav opens Settings too. If the app can't connect, the error screen keeps the cog.
- **Settings** is a small hub with three tiles:
  - **Authentication:** the former Connection screen (app token), renamed, with a "Settings / Authentication" breadcrumb.
  - **API usage:** estimated Airtable calls used this month, with a progress bar (green, amber from 70%, red from 90%) and the reset date.
  - **Release notes:** read live from `RELEASE_NOTES.md`, with the latest version open and older versions collapsed.

## New: API usage counter

- The Worker counts every Airtable call it makes in Cloudflare KV, one counter per calendar month (resets on the 1st). Cached responses cost nothing and are not counted.
- New endpoint `GET /api/usage`. It uses no Airtable calls.
- It is an estimate: Airtable has no usage API, and calls landing in different Worker instances at the same instant can occasionally be missed. Airtable's Usage tab stays the source of truth.

## User action

- In Cloudflare, create a KV namespace and bind it to the Worker with the variable name `USAGE`.
- Add a Worker variable `AIRTABLE_USAGE_SEED` with this month's current figure from Airtable's Usage tab (applied once, the first time the counter runs).
- Optional: `AIRTABLE_MONTHLY_LIMIT` (defaults to 1000).
- Until `USAGE` is bound, the API usage screen shows these setup steps.
- Make sure `RELEASE_NOTES.md` is published alongside the app so Release notes can load it.

## Notes

- No Airtable schema changes. `navigation.js` untouched.
- Files changed: `worker.js`, `app.js`, `styles.css`, `icons.js` (cog, gauge and document icons).

# Daily Life v0.3.3

_13 October 2026_

## Changed: consistent Meals screens

- Meals, Recipes, Meal plan and the recipe screen now use the same header as Lists and Events: "Daily Life" top-left, connection key top-right, section title underneath. The back arrow is gone from these screens.
- Small breadcrumb above the title: "Meals / Recipes" on Recipes and the recipe screen, "Meals / Meal plan" on the planner. Tapping a parent crumb goes there. The Meals hub has no breadcrumb. Android's back button still works as before.

## New: recipe search and filters

- Search box on Recipes covering recipe name, cuisine and ingredient names. Multiple words must all match; the list updates as you type without losing keyboard focus, and there is a clear button.
- Filter pills: **All**, **Quick** (cooking time 30 minutes or less) and one pill per cuisine found in your recipes. The row scrolls sideways. Search and pills combine.
- The search and selected pill are kept while you open a recipe and come back, and reset when the app reloads.

## Notes

- **Quick** only includes recipes with a `Cooking time (mins)` value, so it stays sparse until older recipes are filled in.
- No Worker or Airtable changes (`worker.js` unchanged from v0.3.2). Builds on v0.3.2, so the ingredient ID fix is kept.
- Files changed: `app.js`, `styles.css`, `icons.js` (new search icon).
- Next: API usage counter (v0.3.4), then import from URL (v0.3.5).

# Daily Life v0.3.2

_13 October 2026_

## Bug fix: ingredients showing as IDs

- Recipe ingredients appeared as Airtable record IDs (e.g. `recbNu3TUFVlesp8H`) instead of names.
- Cause: the screen was receiving the older Worker response, which sent raw linked IDs. The recipes cache key is now versioned (`recipes-v2`) so an older cached response can never be served, and the app no longer displays a record ID if it ever receives one (it shows a "Worker needs updating" hint instead).
- Recipes whose ingredients are only linked on the Recipes table (no Ingredients Quantities rows yet) now show those ingredient **names** (without quantities). Where a recipe has some quantity rows, the remaining linked ingredients are appended as names.

## Notes

- No Airtable schema changes. `navigation.js`, `icons.js` and `styles.css` untouched.
- Deploy `worker.js` first, then `app.js`.
- Files changed: `worker.js`, `app.js`.

# Daily Life v0.3.1

_2 October 2026_

## New: Meal plan

- The Meals hub's **Meal plan** card is live and shows how many meals are planned this week.
- Week view (Monday to Sunday) with Breakfast, Lunch and Dinner slots per day. Today is highlighted; chevrons change week and "This week" jumps back.
- A slot can hold several meals (e.g. main + side). Tap **+** on a slot to add another.
- **Add from the planner:** tap a slot's "+", choose a recipe, day, meal and servings.
- **Add from a recipe:** the recipe screen's "Add to meal plan" button asks for day, meal and servings.
- **Planned servings** is prefilled from the recipe's default servings and editable (it will drive scaling on the future shopping list).
- **Edit / move / remove:** tap the "..." on a planned meal to change its recipe, move it to another day or meal, or remove it.
- **Cooked tick:** tick a meal as cooked (uses the existing `Cooked?` checkbox); cooked meals are struck through.
- Edits and cooked ticks update instantly and roll back if saving fails; adding and removing wait for confirmation.
- Home's Today section now lists today's meals in Breakfast, Lunch, Dinner order and understands the existing "Diner" option as Dinner.

## Worker

- New endpoints: `POST /api/meal-plan`, `PATCH /api/meal-plan/:id`, `DELETE /api/meal-plan/:id`. Meal is restricted to Breakfast / Lunch / Dinner, recipe and record IDs are validated, and the meal plan cache is purged on every write.
- `GET /api/meal-plan` now reads from 14 days ago onwards with pagination (one cached payload, 10 minutes). Earlier weeks are not loaded.

## User action

- In Airtable, Weekly plan > Meal: rename **Diner** to **Dinner** and add a **Breakfast** option. The app only writes these three names, and Airtable may reject new select options if the token cannot edit the base schema, so add them by hand.

## Notes

- No other Airtable schema changes. `icons.js` and `navigation.js` untouched.
- The January test records in Weekly plan are ignored (older than 14 days).
- Changes made directly in Airtable can take up to 10 minutes to show in the planner.
- Files changed: `worker.js`, `app.js`, `styles.css`.

# Daily Life v0.3.0

_2 October 2026_

## New: Meals hub and recipe view

- The Home "Meal plan" tile is now **Meals** and opens a hub with **Recipes** and **Meal plan**. The bottom-nav "Recipes" tab is now **Meals** and opens the same hub.
- Meal plan is a "Coming next" placeholder until v0.3.1.
- Recipe screen: ingredients now show quantity, unit and name (e.g. "200 g tat soi, chopped") instead of raw Airtable IDs, read from the existing Ingredients Quantities and Ingredients tables.
- Ingredients and method steps are tickable. Ticks are saved on the device only, with a "Reset ticks" link. Method steps come from the recipe's `Recipe text`, one step per line.
- "View original recipe" link shown when the recipe has a `link`.
- Cooking time reads the new `Cooking time (mins)` field (shown as "30 min").
- Recipes list: removed the non-functional Quick / Family / Favourites pills; back now returns to the hub.

## Changed: Home

- Removed the week strip and "View all". The Today section now lists today's planned meals (Breakfast, Lunch, Dinner order) and no longer falls back to the first recipe when nothing is planned.

## Performance

- Recipes (with ingredients) are one cached payload covering three Airtable tables, about 5 calls per refresh. Cache extended from 10 minutes to 1 hour to protect the 1,000 calls/month limit. Opening a recipe uses the cache, so costs no extra calls.

## Notes

- Airtable: added `Cooking time (mins)` (number) to Recipes. No other schema changes.
- Older recipes have few or no Ingredients Quantities rows, so they show few ingredients until filled in.
- Changes to recipes in Airtable can take up to an hour to appear.
- Files changed: `worker.js`, `app.js`, `styles.css`, `icons.js`. `navigation.js` untouched.

# Daily Life v0.2.12

_1 October 2026_

## Bug fix: filter bar overflow

- The To do filter bar (All/Overdue/Today/Upcoming/Done) overflowed phone screen width after the "Overdue" pill was added in v0.2.11, requiring a horizontal scroll to reach "Done".
- Tightened pill padding and spacing; all 5 pills now fit on screen without scrolling on typical phone widths.
- Also benefits the Recipes screen's filter pills, which share the same styles.

## Notes

- No Airtable schema changes. `styles.css` only.

# Daily Life v0.2.11

_30 September 2026_

## New: Overdue tasks

- The To do screen now flags overdue tasks instead of mixing them silently into "Upcoming".
- New "Overdue" group, pinned above Today, red-accented — only tasks with a past due date and status ≠ Done.
- Due date reads "N day(s) overdue" in red for those tasks.
- New "Overdue" filter pill alongside All/Today/Upcoming/Done.
- A completed task is never flagged overdue, however late it was finished.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.10

_28 September 2026_

## Changed: Home greeting

- The Home greeting and its icon now change with the time of day: "Good morning" (sunrise), "Good afternoon" (sun), "Good evening" (sunset), "Good night" (moon).
- Boundaries: morning 05:00, afternoon 12:00, evening 17:00, night 21:00 — a default, easy to adjust.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.9

_28 September 2026_

## Changed: Icons

- Replaced all emoji/symbol glyphs across the app with real icons (Lucide, inline SVG) — navigation, header, Home cards, recipe detail, to-do screen, events screen, connection/token screens, and modals.
- New `icons.js` file (small inline SVG icon set + `icon(name)` helper); `index.html` now loads it before `app.js`.
- PWA home-screen icon not included in this pass.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.8

_27 September 2026_

## Performance

- Added edge caching (Cloudflare Cache API) in the Worker for Airtable-backed read endpoints, to stay within Airtable's free-plan limit of 1,000 API calls/month.
- Recipes and meal plan cached 10 minutes; to-do options (Category/Status choices) cached 1 hour.
- To-dos cached 45 seconds, and the cache is purged immediately on any create/update/delete so changes still show up promptly everywhere.
- Prompted by hitting 80% of the monthly Airtable API cap during development alone — every page reload had been re-fetching recipes/to-dos/meal-plan fresh, since the client-side cache resets on reload.

## Changed

- No Airtable schema changes. No frontend changes — `worker.js` only.

# Daily Life v0.2.7

_27 September 2026_

## New: Events module

- Google Calendar surfaced on Home (replacing the Shopping tile) and a new dedicated Events screen.
- New "Events" tab in the bottom navigation.
- Reads the family's shared calendar directly via its private ICS feed — no Airtable involved, no write access from the app.
- Events screen shows the next 14 days, grouped by day; the Home tile shows a live count for the next 7 days.
- "Add event" opens Google Calendar in a new tab rather than creating events in-app.

## User action

- Add `CALENDAR_ICS_URL` as a new Worker secret (Google Calendar → calendar settings → "Secret address in iCal format").

## Known limitation

- The ICS/RRULE parser is hand-written to stay dependency-free. It covers common recurring-event patterns (daily/weekly/monthly/yearly, with count/until/exceptions) but not the full iCalendar spec — worth testing against the real calendar's recurring events.

# Daily Life v0.2.6

_27 September 2026_

## Changed: Home page layout

- Reworked the Home module grid into larger 2×2 cards, each with a title, subtitle and chevron.
- Same four modules, same colours, icons and greeting copy as before — visual/layout change only.

---

# Daily Life v0.2.4

## Performance / responsiveness

- Added in-memory client-side caching for recipes, To-do items, meal plan and To-do options.
- Normal navigation now renders from cached state instead of refetching from the Worker on every tap.
- Removed the full-screen Loading transition from normal navigation.
- Added stale-while-revalidate background refresh with a 60-second freshness window.
- Prevented duplicate concurrent requests for the same data set.
- Recipe detail reuses cached recipe data where detail fields are already present.
- To-do status changes update the UI immediately and persist in the background, with rollback on failure.
- To-do edits update local state immediately; the server is only awaited after the UI has changed.
- To-do deletion updates local cache after server confirmation instead of reloading the screen.
- Initial app load still uses a loading state because the first data fetch must complete.
- No Worker changes required.

# Daily Life v0.2.2

## Stability fix

- The To-do screen no longer fails completely if `/api/todo-options` is unavailable (for example, when the currently deployed Worker has not yet been updated, or the Airtable token cannot read schema metadata).
- In that situation the app falls back to categories already used by existing tasks and the standard To do / In progress / Done statuses.
- Recipes, meal plan and the core To-do API continue to use the normal connection/error handling.

---

# Daily Life v0.2.1

## To-do module

- Fixed long UK date display: `Thursday, 17 September 2026`.
- Category options are loaded from the Airtable **Category** single-select field via the Airtable metadata API.
- Status options are loaded from the Airtable **Status** single-select field when available.
- Added **In progress** as a surfaced task state.
- Quick status control cycles **To do → In progress → Done → To do**.
- Done tasks use a solid green circle with no tick.
- Added status selection to the task form.
- Added due-date sorting with **Newest first** as the default and a toggle to **Oldest first**.
- Existing All / Today / Upcoming / Done filters remain in place.

## Scope

Only the To-do frontend and the Worker API endpoint required for Airtable field options were changed. Authentication and other modules were left unchanged.

## Airtable requirement

The app reads single-select choices from Airtable's base schema. The Airtable token used by the Worker must have permission to read base schema metadata. If schema metadata is unavailable, the frontend falls back to categories already present in the loaded tasks and standard statuses.
