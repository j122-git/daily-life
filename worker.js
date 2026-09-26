/*
 * DAILY LIFE — CLOUDFLARE WORKER
 *
 * Airtable base:
 * appPPhBgdyZn98k4w
 *
 * Tables:
 * Recipes = tbllpksHl60IWWk57
 * Weekly plan = tblZFGDTnJzW0ekr9
 * To do = tbl5UZaswultCt19p
 *
 * Environment variables / Secrets:
 * AIRTABLE_TOKEN
 * APP_TOKEN
 * CALENDAR_ICS_URL   — the family calendar's "Secret address in iCal
 *                       format" from Google Calendar settings. Events
 *                       are read directly from Google — nothing is
 *                       written back, and nothing is stored in Airtable.
 */


/* =========================================================
   CONFIG
   ========================================================= */

const BASE_ID = "appPPhBgdyZn98k4w";

const RECIPES_TABLE_ID = "tbllpksHl60IWWk57";
const MEAL_PLAN_TABLE_ID = "tblZFGDTnJzW0ekr9";
const TODOS_TABLE_ID = "tbl5UZaswultCt19p";


/* =========================================================
   WORKER
   ========================================================= */

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    /*
     * CORS
     */
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
      "Access-Control-Max-Age": "86400"
    };


    /*
     * OPTIONS / CORS pre-flight
     */
    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });

    }


    /*
     * Public health check
     */
    if (url.pathname === "/") {

      return json({
        app: "Daily Life API",
        status: "ok"
      }, 200, corsHeaders);

    }


    /*
     * Check environment configuration
     */
    if (!env.APP_TOKEN) {

      return json({
        error: "APP_TOKEN is not configured"
      }, 500, corsHeaders);

    }

    if (!env.AIRTABLE_TOKEN) {

      return json({
        error: "AIRTABLE_TOKEN is not configured"
      }, 500, corsHeaders);

    }


    /*
     * Authenticate app
     */
    const suppliedToken =
      request.headers.get("X-App-Token");

    const configuredToken = env.APP_TOKEN;

    // Debug logging (comment out after fixing)
    console.log("DEBUG: Token authentication check");
    console.log("Supplied token length:", suppliedToken?.length || 0);
    console.log("Configured token length:", configuredToken?.length || 0);
    console.log("Supplied token first 10 chars:", suppliedToken?.substring(0, 10));
    console.log("Configured token first 10 chars:", configuredToken?.substring(0, 10));

    if (
      !suppliedToken ||
      !secureCompare(suppliedToken, configuredToken)
    ) {

      console.log("DEBUG: Token comparison failed");
      return json({
        error: "Unauthorised"
      }, 401, corsHeaders);

    }

    console.log("DEBUG: Token comparison passed");


    /* =====================================================
       RECIPES
       ===================================================== */

    /*
     * GET /api/recipes
     */
    if (
      request.method === "GET" &&
      url.pathname === "/api/recipes"
    ) {

      return await getRecipes(
        url,
        env,
        corsHeaders
      );

    }


    /*
     * GET /api/recipes/:id
     */
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/recipes/")
    ) {

      const recordId =
        url.pathname.split("/")[3];

      if (!recordId) {

        return json({
          error: "Missing recipe ID"
        }, 400, corsHeaders);

      }

      return await getRecipe(
        recordId,
        env,
        corsHeaders
      );

    }


    /* =====================================================
       MEAL PLAN
       ===================================================== */

    /*
     * GET /api/meal-plan
     *
     * Optional:
     *
     * ?start=2026-09-07
     * ?end=2026-09-13
     */
    if (
      request.method === "GET" &&
      url.pathname === "/api/meal-plan"
    ) {

      return await getMealPlan(
        url,
        env,
        corsHeaders
      );

    }


    /* =====================================================
       TO DOS
       ===================================================== */

    /*
     * GET /api/todos
     */
    if (
      request.method === "GET" &&
      url.pathname === "/api/todos"
    ) {

      return await getTodos(
        url,
        env,
        corsHeaders
      );

    }


    /*
     * GET /api/todo-options
     */
    if (
      request.method === "GET" &&
      url.pathname === "/api/todo-options"
    ) {
      return await getTodoOptions(env, corsHeaders);
    }


    /*
     * POST /api/todos
     */
    if (
      request.method === "POST" &&
      url.pathname === "/api/todos"
    ) {

      return await createTodo(
        request,
        env,
        corsHeaders
      );

    }


    /*
     * PATCH /api/todos/:id
     */
    if (
      request.method === "PATCH" &&
      url.pathname.startsWith("/api/todos/")
    ) {

      const recordId =
        url.pathname.split("/")[3];

      if (!recordId) {

        return json({
          error: "Missing todo ID"
        }, 400, corsHeaders);

      }

      return await updateTodo(
        request,
        recordId,
        env,
        corsHeaders
      );

    }


    /*
     * DELETE /api/todos/:id
     */
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith("/api/todos/")
    ) {

      const recordId =
        url.pathname.split("/")[3];

      if (!recordId) {

        return json({
          error: "Missing todo ID"
        }, 400, corsHeaders);

      }

      return await deleteTodo(
        recordId,
        env,
        corsHeaders
      );

    }


    /* =====================================================
       EVENTS (Google Calendar — read-only, via private ICS feed)
       ===================================================== */

    /*
     * GET /api/events
     *
     * Optional:
     *
     * ?days=14   (default 14, capped at 60)
     */
    if (
      request.method === "GET" &&
      url.pathname === "/api/events"
    ) {

      return await getEvents(
        url,
        env,
        corsHeaders
      );

    }


    /*
     * Unknown route
     */
    return json({
      error: "Not found"
    }, 404, corsHeaders);

  }

};


/* =========================================================
   RECIPES — LIST
   ========================================================= */

async function getRecipes(
  url,
  env,
  corsHeaders
) {

  const params = new URLSearchParams();

  params.set("pageSize", "100");

  /*
   * Airtable returns records in chunks if there
   * are more than 100.
   *
   * We currently keep this intentionally simple.
   */
  const airtableUrl =
    `https://api.airtable.com/v0/${BASE_ID}/${RECIPES_TABLE_ID}?${params}`;


  const response = await fetch(
    airtableUrl,
    {
      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }
    }
  );


  const data = await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable recipes request failed",
      details: data
    }, 502, corsHeaders);

  }


  const recipes =
    (data.records || []).map(normaliseRecipe);


  return json({
    recipes
  }, 200, corsHeaders);

}


/* =========================================================
   RECIPES — SINGLE
   ========================================================= */

async function getRecipe(
  recordId,
  env,
  corsHeaders
) {

  const airtableUrl =
    `https://api.airtable.com/v0/${BASE_ID}/${RECIPES_TABLE_ID}/${recordId}`;


  const response = await fetch(
    airtableUrl,
    {
      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }
    }
  );


  const data = await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable recipe request failed",
      details: data
    }, 502, corsHeaders);

  }


  return json({
    recipe: normaliseRecipe(data)
  }, 200, corsHeaders);

}


/* =========================================================
   NORMALISE RECIPE
   ========================================================= */

function normaliseRecipe(record) {

  const fields = record.fields || {};


  /*
   * The Airtable base has evolved over time, so we
   * deliberately support several sensible field names.
   *
   * This prevents the front end being tightly coupled
   * to Airtable's internal field naming.
   */

  return {

    id: record.id,

    name:
      firstValue(
        fields,
        [
          "Name",
          "Recipe",
          "Title"
        ]
      ),

    cuisine:
      firstValue(
        fields,
        [
          "Cuisine",
          "Type"
        ]
      ),

    servings:
      firstValue(
        fields,
        [
          "Default servings",
          "Servings",
          "Default Servings"
        ]
      ),

    image:
      extractAttachment(
        firstValue(
          fields,
          [
            "Image",
            "Photo",
            "Images"
          ]
        )
      ),

    cookingTime:
      firstValue(
        fields,
        [
          "Cooking time",
          "Cooking Time",
          "Total time",
          "Total Time"
        ]
      ),

    difficulty:
      firstValue(
        fields,
        [
          "Difficulty"
        ]
      ),

    notes:
      firstValue(
        fields,
        [
          "Notes",
          "Description"
        ]
      ),

    recipeText:
      firstValue(
        fields,
        [
          "Recipe text",
          "Recipe Text",
          "Instructions",
          "Method"
        ]
      ),

    ingredients:
      firstValue(
        fields,
        [
          "Ingredients"
        ]
      ) || [],

    raw: fields

  };

}


/* =========================================================
   MEAL PLAN
   ========================================================= */

async function getMealPlan(
  url,
  env,
  corsHeaders
) {

  const params = new URLSearchParams();

  params.set("pageSize", "100");


  /*
   * Optional date range.
   *
   * Default = current week around today.
   */
  const start =
    url.searchParams.get("start");

  const end =
    url.searchParams.get("end");


  if (start && end) {

    /*
     * Weekly plan's date field is called "Date".
     *
     * Airtable formula is used rather than relying
     * on the API's date filtering.
     */

    params.set(
      "filterByFormula",
      `AND(
        IS_AFTER({Date}, '${start}'),
        IS_BEFORE({Date}, '${end}')
      )`
    );

  }


  params.set(
    "sort[0][field]",
    "Date"
  );

  params.set(
    "sort[0][direction]",
    "asc"
  );


  const airtableUrl =
    `https://api.airtable.com/v0/${BASE_ID}/${MEAL_PLAN_TABLE_ID}?${params}`;


  const response = await fetch(
    airtableUrl,
    {
      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }
    }
  );


  const data = await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable meal plan request failed",
      details: data
    }, 502, corsHeaders);

  }


  const mealPlan =
    (data.records || []).map(
      normaliseMealPlanRecord
    );


  return json({
    mealPlan
  }, 200, corsHeaders);

}


/* =========================================================
   NORMALISE MEAL PLAN
   ========================================================= */

function normaliseMealPlanRecord(record) {

  const fields = record.fields || {};


  const date =
    firstValue(
      fields,
      [
        "Date",
        "date"
      ]
    );


  const meal =
    firstValue(
      fields,
      [
        "Meal",
        "Category",
        "Type"
      ]
    );


  const linkedRecipe =
    firstValue(
      fields,
      [
        "Recipe"
      ]
    );


  let recipeName = null;

  let recipeId = null;


  /*
   * Airtable linked records may be returned as:
   *
   * ["recXXXX"]
   *
   * or occasionally as expanded/display values.
   */
  if (Array.isArray(linkedRecipe)) {

    recipeId =
      linkedRecipe[0] || null;

  } else if (linkedRecipe) {

    recipeName =
      String(linkedRecipe);

  }


  /*
   * Airtable may expose the linked recipe name
   * through a lookup field.
   */
  const lookupRecipe =
    firstValue(
      fields,
      [
        "Recipe Name",
        "Recipe name",
        "Recipe (Name)"
      ]
    );


  if (!recipeName && lookupRecipe) {

    recipeName =
      Array.isArray(lookupRecipe)
        ? lookupRecipe[0]
        : lookupRecipe;

  }


  return {

    id: record.id,

    date,

    meal,

    recipeId,

    recipeName,

    raw: fields

  };

}


/* =========================================================
   TODOS — LIST
   ========================================================= */

async function getTodos(
  url,
  env,
  corsHeaders
) {

  const params = new URLSearchParams();

  params.set("pageSize", "100");


  params.set(
    "sort[0][field]",
    "Due"
  );

  params.set(
    "sort[0][direction]",
    "asc"
  );


  const airtableUrl =
    `https://api.airtable.com/v0/${BASE_ID}/${TODOS_TABLE_ID}?${params}`;


  const response = await fetch(
    airtableUrl,
    {
      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }
    }
  );


  const data = await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable todos request failed",
      details: data
    }, 502, corsHeaders);

  }


  const todos =
    (data.records || []).map(
      normaliseTodo
    );


  return json({
    todos
  }, 200, corsHeaders);

}


/* =========================================================
   TODO OPTIONS — AIRTABLE FIELD CONFIGURATION
   ========================================================= */

async function getTodoOptions(env, corsHeaders) {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  const data = await response.json();
  if (!response.ok) {
    return json({
      error: "Airtable schema request failed",
      details: data
    }, 502, corsHeaders);
  }

  const table = (data.tables || []).find(t => t.id === TODOS_TABLE_ID);
  const fields = table?.fields || [];
  const categoryField = fields.find(f => f.name === "Category");
  const statusField = fields.find(f => f.name === "Status");

  const choices = field => Array.isArray(field?.options?.choices)
    ? field.options.choices.map(c => c.name).filter(Boolean)
    : [];

  return json({
    categories: choices(categoryField),
    statuses: choices(statusField)
  }, 200, corsHeaders);
}


/* =========================================================
   NORMALISE TODO
   ========================================================= */

function normaliseTodo(record) {

  const fields =
    record.fields || {};


  const due =
    calendarDateOnly(
      firstValue(
        fields,
        [
          "Due"
        ]
      )
    );


  return {

    id: record.id,

    task:
      firstValue(
        fields,
        [
          "Task"
        ]
      ),

    due,

    status:
      firstValue(
        fields,
        [
          "Status"
        ]
      ) || "To do",

    category:
      firstValue(
        fields,
        [
          "Category"
        ]
      ),

    notes:
      firstValue(
        fields,
        [
          "Notes"
        ]
      ),

    relatedRecipe:
      firstValue(
        fields,
        [
          "Related recipe"
        ]
      ),

    bucket:
      getTodoBucket(due),

    raw: fields

  };

}


/* =========================================================
   TODO BUCKET
   ========================================================= */

function getTodoBucket(due) {
  const date = calendarDateOnly(due);
  if (!date) return "upcoming";

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth()+1).padStart(2,"0")}-${String(tomorrowDate.getDate()).padStart(2,"0")}`;

  if (date === today) return "today";
  if (date === tomorrow) return "tomorrow";
  return "upcoming";
}

// Due is a calendar date. Never construct a Date from YYYY-MM-DD for task logic.
function calendarDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/* =========================================================
   TODO — CREATE
   ========================================================= */

async function createTodo(
  request,
  env,
  corsHeaders
) {

  let body;


  try {

    body =
      await request.json();

  } catch {

    return json({
      error: "Invalid JSON"
    }, 400, corsHeaders);

  }


  if (!body.task || !String(body.task).trim()) {

    return json({
      error: "Task is required"
    }, 400, corsHeaders);

  }


  const fields = {

    "Task":
      String(body.task).trim()

  };


  if (body.due) {

    fields["Due"] =
      calendarDateOnly(body.due);

  }


  if (body.status) {

    fields["Status"] =
      body.status;

  }


  if (body.category) {

    fields["Category"] =
      body.category;

  }


  if (body.notes !== undefined) {

    fields["Notes"] =
      String(body.notes);

  }


  /*
   * Related recipe is a linked-record field.
   *
   * The front end can send:
   *
   * relatedRecipeId: "recXXXXXXXX"
   */
  if (body.relatedRecipeId) {

    fields["Related recipe"] = [
      body.relatedRecipeId
    ];

  }


  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${TODOS_TABLE_ID}`,
    {
      method: "POST",

      headers: {

        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`,

        "Content-Type":
          "application/json"

      },

      body: JSON.stringify({
        fields,
        typecast: true
      })

    }
  );


  const data =
    await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable todo creation failed",
      details: data
    }, 502, corsHeaders);

  }


  return json({

    ok: true,

    todo:
      normaliseTodo(data),

    record:
      data

  }, 201, corsHeaders);

}


/* =========================================================
   TODO — UPDATE
   ========================================================= */

async function updateTodo(
  request,
  recordId,
  env,
  corsHeaders
) {

  let body;


  try {

    body =
      await request.json();

  } catch {

    return json({
      error: "Invalid JSON"
    }, 400, corsHeaders);

  }


  const fields = {};


  if (body.task !== undefined) {

    fields["Task"] =
      String(body.task);

  }


  if (body.due !== undefined) {

    fields["Due"] =
      calendarDateOnly(body.due);

  }


  if (body.status !== undefined) {

    fields["Status"] =
      body.status;

  }


  if (body.category !== undefined) {

    fields["Category"] =
      body.category;

  }


  if (body.notes !== undefined) {

    fields["Notes"] =
      body.notes;

  }


  if (body.relatedRecipeId !== undefined) {

    fields["Related recipe"] =
      body.relatedRecipeId
        ? [body.relatedRecipeId]
        : [];

  }


  if (
    Object.keys(fields).length === 0
  ) {

    return json({
      error: "No recognised fields to update"
    }, 400, corsHeaders);

  }


  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${TODOS_TABLE_ID}/${recordId}`,
    {
      method: "PATCH",

      headers: {

        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`,

        "Content-Type":
          "application/json"

      },

      body: JSON.stringify({
        fields,
        typecast: true
      })

    }
  );


  const data =
    await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable todo update failed",
      details: data
    }, 502, corsHeaders);

  }


  return json({

    ok: true,

    todo:
      normaliseTodo(data),

    record:
      data

  }, 200, corsHeaders);

}


/* =========================================================
   TODO — DELETE
   ========================================================= */

async function deleteTodo(
  recordId,
  env,
  corsHeaders
) {

  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${TODOS_TABLE_ID}/${recordId}`,
    {
      method: "DELETE",

      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }

    }
  );


  const data =
    await response.json();


  if (!response.ok) {

    return json({
      error: "Airtable todo deletion failed",
      details: data
    }, 502, corsHeaders);

  }


  return json({

    ok: true,

    deleted: true,

    recordId

  }, 200, corsHeaders);

}


/* =========================================================
   EVENTS — GOOGLE CALENDAR (READ-ONLY, VIA PRIVATE ICS FEED)
   ========================================================= */

async function getEvents(
  url,
  env,
  corsHeaders
) {

  if (!env.CALENDAR_ICS_URL) {

    return json({
      error: "CALENDAR_ICS_URL is not configured"
    }, 500, corsHeaders);

  }


  const daysParam = parseInt(url.searchParams.get("days"), 10);

  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(daysParam, 1), 60)
    : 14;


  const rangeStart = new Date();
  rangeStart.setUTCHours(0, 0, 0, 0);

  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days);


  /*
   * Short server-side cache so the app doesn't re-fetch the whole
   * calendar from Google on every load. Client already caches for
   * 60s on top of this.
   */
  const cache = caches.default;

  const cacheKey = new Request(
    `https://daily-life-cache.internal/events?days=${days}`,
    { method: "GET" }
  );


  let icsText;

  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {

    icsText = await cachedResponse.text();

  } else {

    const icsResponse = await fetch(env.CALENDAR_ICS_URL);

    if (!icsResponse.ok) {

      return json({
        error: "Could not fetch the calendar feed"
      }, 502, corsHeaders);

    }

    icsText = await icsResponse.text();

    await cache.put(
      cacheKey,
      new Response(icsText, {
        headers: { "Cache-Control": "max-age=300" }
      })
    );

  }


  let events;

  try {

    events = expandIcsEvents(icsText, rangeStart, rangeEnd);

  } catch (e) {

    return json({
      error: "Could not parse the calendar feed",
      details: String(e)
    }, 502, corsHeaders);

  }


  return json({
    events
  }, 200, corsHeaders);

}


/* =========================================================
   ICS PARSING — minimal, dependency-free
   =========================================================
   Handles the patterns a typical family Google Calendar
   produces: single events, all-day events, and recurring
   events with FREQ=DAILY / WEEKLY (+ BYDAY) / MONTHLY / YEARLY,
   INTERVAL, COUNT, UNTIL and EXDATE.

   This deliberately does NOT implement the full RFC5545 RRULE
   spec (e.g. BYSETPOS, combined BYMONTHDAY+BYDAY rules). Very
   unusual recurrence patterns may not expand correctly — test
   against the real calendar before relying on this.
   ========================================================= */

function unfoldIcs(text) {

  // RFC5545 line folding: a line starting with a space/tab is a
  // continuation of the previous line.
  return text.replace(/\r\n/g, "\n").split("\n").reduce((lines, line) => {

    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }

    return lines;

  }, []);

}

function parseIcsLine(line) {

  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const [name, ...paramParts] = left.split(";");
  const params = {};

  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq !== -1) params[p.slice(0, eq)] = p.slice(eq + 1);
  }

  return { name: name.toUpperCase(), params, value };

}

function unescapeIcsText(value) {
  return String(value || "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// Converts a wall-clock local time in a given IANA timezone to a UTC Date.
// Uses Intl (available in the Workers runtime) rather than a bundled
// timezone database, to stay dependency-free.
function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {

  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);

  try {

    const tzDate = new Date(new Date(asUtc).toLocaleString("en-US", { timeZone }));
    const utcDate = new Date(new Date(asUtc).toLocaleString("en-US", { timeZone: "UTC" }));
    const offset = utcDate.getTime() - tzDate.getTime();

    return new Date(asUtc + offset);

  } catch {

    // Unknown/unsupported TZID — fall back to UTC rather than failing
    // the whole feed over one event.
    return new Date(asUtc);

  }

}

function icsDateToUtc(value, params) {

  // All-day: YYYYMMDD
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {

    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6);
    const d = +value.slice(6, 8);

    return { date: new Date(Date.UTC(y, m - 1, d)), allDay: true };

  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return { date: null, allDay: false };

  const [, y, mo, d, h, mi, s, z] = match;

  if (z) {
    return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  }

  if (params.TZID) {
    return { date: zonedTimeToUtc(+y, +mo, +d, +h, +mi, +s, params.TZID), allDay: false };
  }

  // Floating time with no zone info — rare from Google. Treat as UTC.
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };

}

function parseIcsEvents(text) {

  const lines = unfoldIcs(text);
  const events = [];
  let current = null;

  for (const raw of lines) {

    if (raw === "BEGIN:VEVENT") { current = {}; continue; }
    if (raw === "END:VEVENT") { if (current) events.push(current); current = null; continue; }
    if (!current) continue;

    const parsed = parseIcsLine(raw);
    if (!parsed) continue;

    const { name, params, value } = parsed;

    if (name === "SUMMARY") current.summary = unescapeIcsText(value);
    else if (name === "LOCATION") current.location = unescapeIcsText(value);
    else if (name === "UID") current.uid = value;
    else if (name === "DTSTART") { current.dtstart = value; current.dtstartParams = params; }
    else if (name === "DTEND") { current.dtend = value; current.dtendParams = params; }
    else if (name === "RRULE") current.rrule = value;
    else if (name === "EXDATE") { current.exdate = current.exdate || []; current.exdate.push(...value.split(",")); }

  }

  return events;

}

function parseRrule(rrule) {
  const parts = {};
  for (const pair of rrule.split(";")) {
    const [k, v] = pair.split("=");
    parts[k] = v;
  }
  return parts;
}

const RRULE_DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Minimal RRULE expansion — see the file-level note above for scope.
function expandRrule(rruleStr, dtstart, rangeEnd, exdates) {

  const rule = parseRrule(rruleStr);
  const freq = rule.FREQ;
  const interval = parseInt(rule.INTERVAL, 10) || 1;
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
  const until = rule.UNTIL ? icsDateToUtc(rule.UNTIL, {}).date : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(",") : null;

  const exSet = new Set(
    (exdates || []).map(v => icsDateToUtc(v.trim(), {}).date?.toISOString())
  );

  const stopDate = until && until < rangeEnd ? until : rangeEnd;
  const hardCap = 366; // safety cap on generated occurrences

  const occurrences = [];
  let cursor = new Date(dtstart);
  let n = 0;

  while (cursor <= stopDate && occurrences.length < hardCap) {

    if (count && n >= count) break;

    if (freq === "WEEKLY" && byday) {

      const weekStart = new Date(cursor);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());

      for (const code of byday) {

        const target = RRULE_DAY_INDEX[code];
        if (target === undefined) continue;

        const occ = new Date(weekStart);
        occ.setUTCDate(occ.getUTCDate() + target);
        occ.setUTCHours(dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds(), 0);

        if (occ >= dtstart && occ <= stopDate && !exSet.has(occ.toISOString())) {
          occurrences.push(occ);
        }

      }

      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      cursor = next;
      n++;
      continue;

    }

    if (!exSet.has(cursor.toISOString())) occurrences.push(new Date(cursor));
    n++;

    const next = new Date(cursor);

    if (freq === "DAILY") next.setUTCDate(next.getUTCDate() + interval);
    else if (freq === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * interval);
    else if (freq === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + interval);
    else if (freq === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + interval);
    else break; // unsupported FREQ — stop rather than loop forever

    cursor = next;

  }

  return occurrences.filter(d => d <= rangeEnd);

}

function toEvent(ev, start, end, allDay) {
  return {
    id: ev.uid ? `${ev.uid}-${start.toISOString()}` : `${ev.summary}-${start.toISOString()}`,
    title: ev.summary,
    location: ev.location || null,
    allDay,
    start: allDay ? start.toISOString().slice(0, 10) : start.toISOString(),
    end: allDay ? end.toISOString().slice(0, 10) : end.toISOString()
  };
}

function expandIcsEvents(text, rangeStart, rangeEnd) {

  const raw = parseIcsEvents(text);
  const out = [];

  for (const ev of raw) {

    if (!ev.dtstart || !ev.summary) continue;

    const start = icsDateToUtc(ev.dtstart, ev.dtstartParams || {});
    if (!start.date) continue;

    const end = ev.dtend ? icsDateToUtc(ev.dtend, ev.dtendParams || {}) : start;
    const durationMs = end.date ? (end.date.getTime() - start.date.getTime()) : 0;

    if (!ev.rrule) {

      const eventEnd = end.date || start.date;

      if (start.date < rangeEnd && eventEnd > rangeStart) {
        out.push(toEvent(ev, start.date, eventEnd, start.allDay));
      }

      continue;

    }

    const occurrences = expandRrule(ev.rrule, start.date, rangeEnd, ev.exdate || []);

    for (const occStart of occurrences) {

      const occEnd = new Date(occStart.getTime() + durationMs);

      if (occStart < rangeEnd && occEnd > rangeStart) {
        out.push(toEvent(ev, occStart, occEnd, start.allDay));
      }

    }

  }

  out.sort((a, b) => new Date(a.start) - new Date(b.start));

  return out;

}


/* =========================================================
   HELPERS
   ========================================================= */


/*
 * Return the first field that actually exists.
 */
function firstValue(
  fields,
  names
) {

  for (const name of names) {

    if (
      fields[name] !== undefined &&
      fields[name] !== null
    ) {

      return fields[name];

    }

  }

  return null;

}


/*
 * Airtable attachment helper.
 */
function extractAttachment(value) {

  if (!value) {
    return null;
  }


  if (Array.isArray(value)) {

    const first =
      value[0];

    if (!first) {
      return null;
    }


    if (typeof first === "string") {
      return first;
    }


    return (
      first.thumbnails?.large?.url ||
      first.thumbnails?.full?.url ||
      first.url ||
      null
    );

  }


  if (typeof value === "object") {

    return (
      value.thumbnails?.large?.url ||
      value.thumbnails?.full?.url ||
      value.url ||
      null
    );

  }


  return String(value);

}


/*
 * JSON response helper.
 */
function json(
  data,
  status = 200,
  corsHeaders = {}
) {

  return new Response(

    JSON.stringify(data),

    {
      status,

      headers: {

        "Content-Type":
          "application/json",

        ...corsHeaders

      }

    }

  );

}


/*
 * Constant-time-ish comparison.
 *
 * Same approach as the existing Baby Worker.
 */
function secureCompare(a, b) {

  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {

    return false;

  }


  if (a.length !== b.length) {

    return false;

  }


  let result = 0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);

  }


  return result === 0;

}
