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
 * Ingredients = tblK8uUPdQ3s43ZOk
 * Ingredients Quantities = tbl70xlNT8xvPCDOP
 *
 * Environment variables / Secrets:
 * AIRTABLE_TOKEN
 * APP_TOKEN
 * USAGE (KV namespace binding) — counts Airtable API calls for the
 *                       Settings > API usage screen.
 * AIRTABLE_USAGE_SEED  — optional number: the current month's figure
 *                       from Airtable's Usage tab. Applied once, the
 *                       first time the counter runs.
 * AIRTABLE_MONTHLY_LIMIT — optional number, default 1000.
 * FAMILY_DRIVE_URL    — the family Google Drive link (https). Kept as a
 *                       Worker secret so it never appears in the public
 *                       site code; served to the app by GET /api/links.
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
const INGREDIENTS_TABLE_ID = "tblK8uUPdQ3s43ZOk";
const INGREDIENT_QUANTITIES_TABLE_ID = "tbl70xlNT8xvPCDOP";

const BUDGET_CATEGORIES_TABLE_ID = "tblJIhyndPRLLzRhC";
const BUDGET_TRANSACTIONS_TABLE_ID = "tbl0eITDQks2Th4of";
const BUDGET_RULES_TABLE_ID = "tblMAZhjgOZt9f935";
const BUDGET_HISTORY_TABLE_ID = "tbl2P3CbzZEgPUVUy";


/* =========================================================
   EDGE CACHE (Cloudflare Cache API)

   Airtable's free plan allows only 1,000 API calls/month, so read
   endpoints are cached at the edge to keep repeated app loads (dev
   reloads included) from spending that budget:

     Recipes         1 hour  — rarely changes; one payload covers
                               Recipes + Ingredients Quantities + Ingredients
                               (about 5 Airtable calls per refresh)
     Meal plan       10 min  — rarely changes
     To-do options    1 hour — schema rarely changes
     To-dos          45 sec  — purged immediately on any create/
                               update/delete, so changes still show
                               up promptly everywhere

   The calendar feed (/api/events) has its own separate cache further
   down — it doesn't touch Airtable at all, so isn't part of this budget.
   ========================================================= */

const CACHE_TTL = {
  RECIPES: 3600,
  MEAL_PLAN: 600,
  TODO_OPTIONS: 3600,
  TODOS: 45,
  BUDGET: 600
};

const TODOS_CACHE_KEY = "https://daily-life-cache.internal/todos";


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

    if (
      !suppliedToken ||
      !secureCompare(suppliedToken, configuredToken)
    ) {

      return json({
        error: "Unauthorised"
      }, 401, corsHeaders);

    }


    const { method } = request;
    const path = url.pathname;
    const id = path.split("/")[3];
    const bad = message => json({ error: message }, 400, corsHeaders);

    const routes = {
      GET: {
        "/api/recipes": () => getRecipes(url, env, corsHeaders),
        "/api/meal-plan": () => getMealPlan(url, env, corsHeaders),
        "/api/todos": () => getTodos(url, env, corsHeaders),
        "/api/todo-options": () => getTodoOptions(env, corsHeaders),
        "/api/links": () => getLinks(env, corsHeaders),
        "/api/usage": () => getUsage(env, corsHeaders),
        "/api/events": () => getEvents(url, env, corsHeaders),
        "/api/budget": () => getBudget(env, corsHeaders)
      },
      POST: {
        "/api/meal-plan": () => createMealPlanEntry(request, env, corsHeaders),
        "/api/todos": () => createTodo(request, env, corsHeaders),
        "/api/import/preview": () => importPreview(request, env, corsHeaders),
        "/api/import/save": () => importSave(request, env, corsHeaders),
        "/api/budget/categories": () => saveBudgetCategories(request, env, corsHeaders)
      }
    };

    const route = routes[method]?.[path];

    if (route) return await route();

    // Routes with a record ID: /api/<collection>/:id
    if (method === "GET" && path.startsWith("/api/recipes/")) {
      return id ? await getRecipe(id, env, corsHeaders) : bad("Missing recipe ID");
    }

    const edits = method === "PATCH" || method === "DELETE";

    if (edits && path.startsWith("/api/meal-plan/")) {
      if (!AIRTABLE_RECORD_ID.test(id || "")) return bad("Invalid meal plan ID");
      return await (method === "PATCH"
        ? updateMealPlanEntry(request, id, env, corsHeaders)
        : deleteMealPlanEntry(id, env, corsHeaders));
    }

    if (edits && path.startsWith("/api/todos/")) {
      if (!AIRTABLE_RECORD_ID.test(id || "")) return bad("Invalid todo ID");
      return await (method === "PATCH"
        ? updateTodo(request, id, env, corsHeaders)
        : deleteTodo(id, env, corsHeaders));
    }


    /*
     * Unknown route
     */
    return json({
      error: "Not found"
    }, 404, corsHeaders);

  },


  /*
   * Cron trigger: monthly budget roll-up (see BUDGET ROLL-UP).
   */
  async scheduled(event, env, ctx) {

    ctx.waitUntil(
      rollUpBudget(env)
        .then(result => console.log("Budget roll-up:", JSON.stringify(result)))
        .catch(error => console.error("Budget roll-up failed:", String(error)))
    );

  }

};


/* =========================================================
   RECIPES — LIST
   =========================================================
   One cached payload holds every recipe with its ingredients,
   read from three tables:

     Recipes              recipe details
     Ingredients Quantities  recipe + ingredient + quantity + unit
     Ingredients          ingredient names

   Airtable returns max 100 records per page, so each table is
   read page by page.
   ========================================================= */

// "-v2": the payload shape changed in v0.3.0, so never serve an older cached shape.
const RECIPES_CACHE_KEY = "https://daily-life-cache.internal/recipes-v2";

async function fetchAllRecords(tableId, env, extraParams = {}) {

  const records = [];
  let offset = null;
  let pages = 0;

  do {

    const params = new URLSearchParams();

    params.set("pageSize", "100");

    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }

    if (offset) {
      params.set("offset", offset);
    }

    const response = await airtableFetch(env, 
      `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params}`,
      {
        headers: {
          "Authorization":
            `Bearer ${env.AIRTABLE_TOKEN}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { error: data };
    }

    records.push(...(data.records || []));

    offset = data.offset || null;
    pages++;

  // shortcut: stops at 5,000 rows; callers that must see everything check `truncated`
  } while (offset && pages < 50);

  return { records, truncated: Boolean(offset) };

}

async function getRecipes(
  url,
  env,
  corsHeaders
) {

  return withCache(
    RECIPES_CACHE_KEY,
    CACHE_TTL.RECIPES,
    corsHeaders,
    async () => {

      const [recipeResult, quantityResult, ingredientResult] =
        await Promise.all([
          fetchAllRecords(RECIPES_TABLE_ID, env),
          fetchAllRecords(INGREDIENT_QUANTITIES_TABLE_ID, env),
          fetchAllRecords(INGREDIENTS_TABLE_ID, env)
        ]);

      const failed =
        [recipeResult, quantityResult, ingredientResult]
          .find(result => result.error);

      if (failed) {
        return { error: "Airtable recipes request failed", details: failed.error, status: 502 };
      }

      const ingredientNames = new Map(
        ingredientResult.records.map(record => [
          record.id,
          firstValue(record.fields || {}, ["Name"])
        ])
      );

      const linesByRecipe = new Map();

      for (const record of quantityResult.records) {

        const recipeId = ((record.fields || {})["Recipe"] || [])[0];
        const line = normaliseIngredientLine(record, ingredientNames);

        if (!recipeId || !line) continue;

        if (!linesByRecipe.has(recipeId)) {
          linesByRecipe.set(recipeId, []);
        }

        linesByRecipe.get(recipeId).push(line);

      }

      const recipes =
        recipeResult.records.map(record =>
          normaliseRecipe(
            record,
            mergeIngredientLines(
              linesByRecipe.get(record.id) || [],
              (record.fields || {})["Ingredients"] || [],
              ingredientNames
            )
          )
        );

      return { data: { recipes } };

    }
  );

}


/* =========================================================
   RECIPES — SINGLE
   =========================================================
   Served from the same cached payload as the list, so opening
   a recipe costs no extra Airtable calls.
   ========================================================= */

async function getRecipe(
  recordId,
  env,
  corsHeaders
) {

  const listResponse =
    await getRecipes(null, env, corsHeaders);

  if (!listResponse.ok) {
    return listResponse;
  }

  const { recipes } = await listResponse.json();

  const recipe =
    (recipes || []).find(r => r.id === recordId);

  if (!recipe) {

    return json({
      error: "Recipe not found"
    }, 404, corsHeaders);

  }

  return json({
    recipe
  }, 200, corsHeaders);

}


/* =========================================================
   MERGE INGREDIENT LINES
   =========================================================
   Quantity rows come first. Any ingredient linked to the recipe
   (Recipes > Ingredients) that has no quantity row yet is added
   as a name-only line, so older recipes still show ingredient
   names (without quantities) rather than nothing.
   ========================================================= */

function mergeIngredientLines(lines, linkedIds, ingredientNames) {

  const covered = new Set(lines.map(line => line.ingredientId).filter(Boolean));

  const extras = [];

  for (const id of linkedIds) {

    const name = ingredientNames.get(id);

    if (!name || covered.has(id)) continue;

    covered.add(id);

    extras.push({
      id,
      ingredientId: id,
      name,
      quantity: null,
      unit: null,
      preparation: null,
      optional: false,
      text: name
    });

  }

  return [...lines, ...extras];

}


/* =========================================================
   NORMALISE INGREDIENT LINE
   =========================================================
   One row of the Ingredients Quantities table. Displays the
   quantity as originally written (Original Quantity / Unit),
   falling back to the base quantity/unit.
   ========================================================= */

function formatQuantity(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

function normaliseIngredientLine(record, ingredientNames) {

  const fields = record.fields || {};

  const ingredientId =
    (fields["Ingredient"] || [])[0] || null;

  const ingredientName =
    ingredientId ? ingredientNames.get(ingredientId) : null;

  const label =
    firstValue(fields, ["Name"]);

  const name = ingredientName || label;

  if (!name) {
    return null;
  }

  const usesOriginal =
    fields["Original Quantity"] !== undefined &&
    fields["Original Quantity"] !== null;

  const quantity =
    usesOriginal
      ? fields["Original Quantity"]
      : firstValue(fields, ["Quantity (base)"]);

  const unit =
    (usesOriginal
      ? fields["Original Unit"]
      : fields["Unit (base)"]) || "";

  const preparation = fields["Preparation"] || "";

  const optional = Boolean(fields["Optional?"]);

  let text;

  if (quantity !== null && quantity !== undefined) {

    const tightUnit =
      ["g", "kg", "ml", "l"].includes(String(unit).toLowerCase());

    const unitText =
      unit ? `${tightUnit ? "" : " "}${unit}` : "";

    text = `${formatQuantity(quantity)}${unitText} ${name}`;

  } else {

    /*
     * No numeric quantity (e.g. "handful"): the row's own
     * label already reads naturally.
     */
    text = label || name;

  }

  if (preparation) text += `, ${preparation}`;
  if (optional) text += " (optional)";

  return {
    id: record.id,
    ingredientId,
    name,
    quantity: quantity ?? null,
    unit: unit || null,
    preparation: preparation || null,
    optional,
    text
  };

}


/* =========================================================
   NORMALISE RECIPE
   ========================================================= */

function normaliseRecipe(record, ingredients = []) {

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
          "Cooking time (mins)",
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

    sourceUrl:
      firstValue(
        fields,
        [
          "link",
          "Link",
          "Source URL"
        ]
      ),

    ingredients

  };

}


/* =========================================================
   MEAL PLAN
   =========================================================
   Weekly plan table: Date, Meal, Recipe (link), Planned servings,
   Cooked?. One record per planned meal; a slot (day + meal) may
   hold several records. Reads cover the last 14 days onwards in
   one cached payload; every write purges that cache.
   ========================================================= */

const MEAL_PLAN_CACHE_KEY = "https://daily-life-cache.internal/meal-plan";

const MEAL_SLOTS = ["Breakfast", "Lunch", "Dinner"];

const AIRTABLE_RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

async function getMealPlan(
  url,
  env,
  corsHeaders
) {

  return withCache(
    MEAL_PLAN_CACHE_KEY,
    CACHE_TTL.MEAL_PLAN,
    corsHeaders,
    async () => {

      const from = new Date();

      from.setUTCDate(from.getUTCDate() - 14);

      const fromDate = from.toISOString().slice(0, 10);

      const result = await fetchAllRecords(
        MEAL_PLAN_TABLE_ID,
        env,
        {
          filterByFormula: `IS_AFTER({Date}, '${fromDate}')`,
          "sort[0][field]": "Date",
          "sort[0][direction]": "asc"
        }
      );

      if (result.error) {
        return { error: "Airtable meal plan request failed", details: result.error, status: 502 };
      }

      return {
        data: {
          mealPlan: result.records.map(normaliseMealPlanRecord)
        }
      };

    }
  );

}


/* =========================================================
   MEAL PLAN — WRITE HELPERS
   ========================================================= */

/*
 * Validates a request body and builds Airtable fields.
 * `creating` = all of date, meal and recipeId are required.
 * Meal is restricted to the three known slots so a typo can
 * never create a stray select option.
 */
function mealPlanFields(body, creating) {

  const fields = {};

  if (creating || body.date !== undefined) {

    const date = calendarDateOnly(body.date);

    if (!date) {
      return { error: "A valid date is required" };
    }

    fields["Date"] = date;

  }

  if (creating || body.meal !== undefined) {

    if (!MEAL_SLOTS.includes(body.meal)) {
      return { error: "Meal must be Breakfast, Lunch or Dinner" };
    }

    fields["Meal"] = body.meal;

  }

  if (creating || body.recipeId !== undefined) {

    if (!AIRTABLE_RECORD_ID.test(String(body.recipeId || ""))) {
      return { error: "A valid recipe is required" };
    }

    fields["Recipe"] = [body.recipeId];

  }

  if (body.servings !== undefined) {

    if (body.servings === null) {

      if (!creating) {
        fields["Planned servings"] = null;
      }

    } else {

      const servings = Number(body.servings);

      if (!(servings > 0 && servings <= 100)) {
        return { error: "Servings must be above 0 and at most 100" };
      }

      fields["Planned servings"] = Math.round(servings * 10) / 10;

    }

  }

  if (body.cooked !== undefined) {
    fields["Cooked?"] = Boolean(body.cooked);
  }

  return { fields };

}


/* =========================================================
   RECORD WRITES (shared by the meal plan and to-dos)
   ========================================================= */

async function readJson(request, corsHeaders) {

  try {
    return { body: (await request.json()) || {} };
  } catch {
    return { response: json({ error: "Invalid JSON" }, 400, corsHeaders) };
  }

}

/*
 * Creates, updates or deletes one Airtable record, then purges the
 * cached list. `failure` is the error message if Airtable refuses.
 */
async function writeRecord(env, corsHeaders, o) {

  const response = await airtableFetch(env,
    `https://api.airtable.com/v0/${BASE_ID}/${o.table}${o.recordId ? `/${o.recordId}` : ""}`,
    {
      method: o.method,
      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: o.fields ? JSON.stringify({ fields: o.fields, typecast: true }) : undefined
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return json({ error: o.failure, details: data }, 502, corsHeaders);
  }

  await purgeCache(o.cacheKey);

  return json(o.reply(data), o.status, corsHeaders);

}

const deleted = recordId => () => ({ ok: true, deleted: true, recordId });


/* =========================================================
   MEAL PLAN — CREATE / UPDATE / DELETE
   ========================================================= */

const writeMeal = (env, corsHeaders, options) =>
  writeRecord(env, corsHeaders, {
    table: MEAL_PLAN_TABLE_ID,
    cacheKey: MEAL_PLAN_CACHE_KEY,
    reply: data => ({ ok: true, entry: normaliseMealPlanRecord(data) }),
    ...options
  });

async function createMealPlanEntry(request, env, corsHeaders) {

  const read = await readJson(request, corsHeaders);
  if (read.response) return read.response;

  const parsed = mealPlanFields(read.body, true);

  if (parsed.error) return json({ error: parsed.error }, 400, corsHeaders);

  return writeMeal(env, corsHeaders, {
    method: "POST",
    fields: parsed.fields,
    failure: "Airtable meal plan creation failed",
    status: 201
  });

}

async function updateMealPlanEntry(request, recordId, env, corsHeaders) {

  const read = await readJson(request, corsHeaders);
  if (read.response) return read.response;

  const parsed = mealPlanFields(read.body, false);

  if (parsed.error) return json({ error: parsed.error }, 400, corsHeaders);

  if (Object.keys(parsed.fields).length === 0) {
    return json({ error: "No recognised fields to update" }, 400, corsHeaders);
  }

  return writeMeal(env, corsHeaders, {
    method: "PATCH",
    recordId,
    fields: parsed.fields,
    failure: "Airtable meal plan update failed",
    status: 200
  });

}

function deleteMealPlanEntry(recordId, env, corsHeaders) {

  return writeMeal(env, corsHeaders, {
    method: "DELETE",
    recordId,
    failure: "Airtable meal plan deletion failed",
    status: 200,
    reply: deleted(recordId)
  });

}


/* =========================================================
   NORMALISE MEAL PLAN
   ========================================================= */

function normaliseMealPlanRecord(record) {

  const fields = record.fields || {};

  const linkedRecipe =
    firstValue(fields, ["Recipe"]);

  return {

    id: record.id,

    date:
      calendarDateOnly(
        firstValue(fields, ["Date", "date"])
      ),

    meal:
      firstValue(fields, ["Meal", "Category", "Type"]),

    recipeId:
      Array.isArray(linkedRecipe)
        ? (linkedRecipe[0] || null)
        : null,

    servings:
      firstValue(fields, ["Planned servings"]),

    cooked:
      Boolean(fields["Cooked?"])

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

  return withCache(
    TODOS_CACHE_KEY,
    CACHE_TTL.TODOS,
    corsHeaders,
    async () => {

      const result = await fetchAllRecords(TODOS_TABLE_ID, env, {
        "sort[0][field]": "Due",
        "sort[0][direction]": "asc"
      });

      if (result.error) {
        return { error: "Airtable todos request failed", details: result.error, status: 502 };
      }

      const todos = result.records.map(normaliseTodo);


      return { data: { todos } };

    }
  );

}


/* =========================================================
   TODO OPTIONS — AIRTABLE FIELD CONFIGURATION
   ========================================================= */

async function getTodoOptions(env, corsHeaders) {

  return withCache(
    "https://daily-life-cache.internal/todo-options",
    CACHE_TTL.TODO_OPTIONS,
    corsHeaders,
    async () => {

      const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
      const response = await airtableFetch(env, url, {
        headers: { "Authorization": `Bearer ${env.AIRTABLE_TOKEN}` }
      });
      const data = await response.json();

      if (!response.ok) {
        return { error: "Airtable schema request failed", details: data, status: 502 };
      }

      const table = (data.tables || []).find(t => t.id === TODOS_TABLE_ID);
      const fields = table?.fields || [];
      const categoryField = fields.find(f => f.name === "Category");
      const statusField = fields.find(f => f.name === "Status");

      const choices = field => Array.isArray(field?.options?.choices)
        ? field.options.choices.map(c => c.name).filter(Boolean)
        : [];

      return {
        data: {
          categories: choices(categoryField),
          statuses: choices(statusField)
        }
      };

    }
  );

}


/*
 * Rejects a status or category that isn't an Airtable option, so
 * typecast can't create stray select choices. Returns an error
 * message, or null when fine.
 */
async function checkTodoOptions(body, env, corsHeaders) {

  if (!body.status && !body.category) return null;

  const response = await getTodoOptions(env, corsHeaders);

  // shortcut: if the schema can't be read, skip the check (the app falls back the same way)
  if (!response.ok) return null;

  const { categories, statuses } = await response.json();

  if (body.status && statuses.length && !statuses.includes(body.status)) {
    return `Unknown status "${body.status}"`;
  }

  if (body.category && categories.length && !categories.includes(body.category)) {
    return `Unknown category "${body.category}"`;
  }

  return null;

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

  };

}


// Due is a calendar date. Never construct a Date from YYYY-MM-DD for task logic.
function calendarDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/* =========================================================
   TODO — CREATE / UPDATE / DELETE
   ========================================================= */

const writeTodo = (env, corsHeaders, options) =>
  writeRecord(env, corsHeaders, {
    table: TODOS_TABLE_ID,
    cacheKey: TODOS_CACHE_KEY,
    reply: data => ({ ok: true, todo: normaliseTodo(data) }),
    ...options
  });

async function createTodo(request, env, corsHeaders) {

  const read = await readJson(request, corsHeaders);
  if (read.response) return read.response;

  const body = read.body;

  if (!body.task || !String(body.task).trim()) {
    return json({ error: "Task is required" }, 400, corsHeaders);
  }

  const optionError = await checkTodoOptions(body, env, corsHeaders);

  if (optionError) return json({ error: optionError }, 400, corsHeaders);

  const fields = { "Task": String(body.task).trim() };

  if (body.due) fields["Due"] = calendarDateOnly(body.due);
  if (body.status) fields["Status"] = body.status;
  if (body.category) fields["Category"] = body.category;
  if (body.notes !== undefined) fields["Notes"] = String(body.notes);

  // Related recipe is a linked-record field: the app sends relatedRecipeId.
  if (body.relatedRecipeId) fields["Related recipe"] = [body.relatedRecipeId];

  return writeTodo(env, corsHeaders, {
    method: "POST",
    fields,
    failure: "Airtable todo creation failed",
    status: 201
  });

}

async function updateTodo(request, recordId, env, corsHeaders) {

  const read = await readJson(request, corsHeaders);
  if (read.response) return read.response;

  const body = read.body;

  const optionError = await checkTodoOptions(body, env, corsHeaders);

  if (optionError) return json({ error: optionError }, 400, corsHeaders);

  const fields = {};

  if (body.task !== undefined) fields["Task"] = String(body.task);
  if (body.due !== undefined) fields["Due"] = calendarDateOnly(body.due);
  if (body.status !== undefined) fields["Status"] = body.status;
  if (body.category !== undefined) fields["Category"] = body.category;
  if (body.notes !== undefined) fields["Notes"] = body.notes;

  if (body.relatedRecipeId !== undefined) {
    fields["Related recipe"] = body.relatedRecipeId ? [body.relatedRecipeId] : [];
  }

  if (Object.keys(fields).length === 0) {
    return json({ error: "No recognised fields to update" }, 400, corsHeaders);
  }

  return writeTodo(env, corsHeaders, {
    method: "PATCH",
    recordId,
    fields,
    failure: "Airtable todo update failed",
    status: 200
  });

}

function deleteTodo(recordId, env, corsHeaders) {

  return writeTodo(env, corsHeaders, {
    method: "DELETE",
    recordId,
    failure: "Airtable todo deletion failed",
    status: 200,
    reply: deleted(recordId)
  });

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


  // optional ?from=YYYY-MM-DD (the calendar's month and week views); defaults to today
  const from = url.searchParams.get("from");

  const rangeStart = /^\d{4}-\d{2}-\d{2}$/.test(from || "")
    ? new Date(`${from}T00:00:00Z`)
    : new Date();

  if (Number.isNaN(rangeStart.getTime())) {
    return json({ error: "Invalid from date" }, 400, corsHeaders);
  }

  rangeStart.setUTCHours(0, 0, 0, 0);

  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days);


  /*
   * Short server-side cache so the app doesn't re-fetch the whole
   * calendar from Google on every load. Client already caches for
   * 60s on top of this. This is separate from the Airtable edge
   * cache above — Google's ICS feed doesn't count against Airtable's
   * monthly API budget at all.
   */
  const cache = caches.default;

  const cacheKey = new Request(
    "https://daily-life-cache.internal/events",
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
function expandRrule(rruleStr, dtstart, rangeStart, rangeEnd, exdates) {

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
  let steps = 0;

  // hardCap counts only occurrences in range; `steps` bounds the walk from an old start date
  while (cursor <= stopDate && occurrences.length < hardCap && steps++ < 20000) {

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

        if (occ >= dtstart && occ >= rangeStart && occ <= stopDate && !exSet.has(occ.toISOString())) {
          occurrences.push(occ);
        }

      }

      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      cursor = next;
      n++;
      continue;

    }

    if (cursor >= rangeStart && !exSet.has(cursor.toISOString())) occurrences.push(new Date(cursor));
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

    const occurrences = expandRrule(
      ev.rrule,
      start.date,
      new Date(rangeStart.getTime() - durationMs), // keep events already under way
      rangeEnd,
      ev.exdate || []
    );

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


/* =========================================================
   EDGE CACHE HELPERS
   ========================================================= */

/*
 * Serves a GET response from the edge cache when available;
 * otherwise runs `loader`, caches a successful result, and
 * returns it. `loader` resolves to either { data } or
 * { error, details, status } — errors are never cached.
 */
async function withCache(cacheUrl, ttlSeconds, corsHeaders, loader) {

  const cache = caches.default;
  const cacheKey = new Request(cacheUrl, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = await loader();

  if (result.error) {
    return json({
      error: result.error,
      details: result.details
    }, result.status || 502, corsHeaders);
  }

  const response = new Response(JSON.stringify(result.data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${ttlSeconds}`,
      ...corsHeaders
    }
  });

  await cache.put(cacheKey, response.clone());

  return response;

}

/*
 * Removes a cached entry — used after writes so the next read
 * is guaranteed fresh rather than waiting out the TTL.
 */
async function purgeCache(cacheUrl) {
  await caches.default.delete(new Request(cacheUrl, { method: "GET" }));
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


/* =========================================================
   API USAGE COUNTER
   =========================================================
   Airtable exposes no usage API, so the Worker counts its own
   Airtable calls in Workers KV (binding: USAGE), one counter per
   calendar month (UTC). It is an estimate: cache hits cost
   nothing and are not counted, and two calls landing in
   different Worker instances at the same instant can be missed.

   AIRTABLE_USAGE_SEED (optional) is applied once, to the first
   month the counter runs, to match Airtable's own Usage tab.
   ========================================================= */

const USAGE_DEFAULT_LIMIT = 1000;

function usageMonthKey(date = new Date()) {
  return `usage:${date.toISOString().slice(0, 7)}`;
}

// Serialises counting inside one Worker instance so the parallel
// Airtable reads in one request don't overwrite each other.
let usageChain = Promise.resolve();

function countAirtableCall(env) {

  if (!env.USAGE) return Promise.resolve();

  usageChain = usageChain
    .then(async () => {

      const key = usageMonthKey();
      let current = parseInt(await env.USAGE.get(key), 10);

      if (!Number.isFinite(current)) {

        current = 0;

        if ((await env.USAGE.get("usage:seeded")) === null) {

          current = Math.max(0, parseInt(env.AIRTABLE_USAGE_SEED, 10) || 0);

          await env.USAGE.put("usage:seeded", new Date().toISOString());

        }

      }

      await env.USAGE.put(key, String(current + 1));

    })
    .catch(error => console.warn("Usage counter failed:", String(error)));

  return usageChain;

}

async function airtableFetch(env, url, options) {

  await countAirtableCall(env);

  return fetch(url, options);

}

async function getUsage(env, corsHeaders) {

  const headers = { ...corsHeaders, "Cache-Control": "no-store" };

  if (!env.USAGE) {

    return json({
      available: false,
      reason: "The USAGE KV namespace is not bound to this Worker"
    }, 200, headers);

  }

  const now = new Date();

  const seeded = (await env.USAGE.get("usage:seeded")) !== null;

  let used = parseInt(await env.USAGE.get(usageMonthKey(now)), 10);

  if (!Number.isFinite(used)) {

    used = seeded
      ? 0
      : Math.max(0, parseInt(env.AIRTABLE_USAGE_SEED, 10) || 0);

  }

  const limit =
    parseInt(env.AIRTABLE_MONTHLY_LIMIT, 10) || USAGE_DEFAULT_LIMIT;

  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  return json({
    available: true,
    used,
    limit,
    percent: Math.round((used / limit) * 100),
    month: now.toISOString().slice(0, 7),
    resetsOn: nextMonth.toISOString().slice(0, 10)
  }, 200, headers);

}


/* =========================================================
   RECIPE IMPORT FROM A URL
   =========================================================
   Preview: fetch the page, read its schema.org Recipe data
   (JSON-LD), parse the ingredient lines, match them against the
   Ingredients table. No Airtable writes.

   Save: create missing Ingredients, the Recipe, then one
   Ingredients Quantities row per line (batches of 10).

   Plain JavaScript only: no external services.
   ========================================================= */

const IMPORT_MAX_BYTES = 2000000;
const IMPORT_TIMEOUT_MS = 8000;
const INGREDIENT_INDEX_KEY = "https://daily-life-cache.internal/ingredient-index-v1";

/* ---- Caching helper that returns plain data ---- */

async function cachedData(cacheUrl, ttlSeconds, loader) {

  const cache = caches.default;
  const key = new Request(cacheUrl, { method: "GET" });

  const hit = await cache.match(key);

  if (hit) return await hit.json();

  const data = await loader();

  await cache.put(
    key,
    new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${ttlSeconds}`
      }
    })
  );

  return data;

}


/* ---- URL safety ---- */

function isPrivateHost(hostname) {

  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");

  if (!h) return true;

  if (
    h === "localhost" ||
    /\.(localhost|local|internal|lan|home|corp)$/.test(h)
  ) return true;

  // IPv6 literals are not needed for recipe sites
  if (h.includes(":")) return true;

  // single-label hosts (e.g. "intranet")
  if (!h.includes(".")) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (v4) {

    const a = Number(v4[1]);
    const b = Number(v4[2]);

    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );

  }

  return false;

}

function validateImportUrl(raw) {

  let parsed;

  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    return { error: "Enter a valid web address" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only http and https links are supported" };
  }

  if (parsed.username || parsed.password) {
    return { error: "Links with a username or password are not supported" };
  }

  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    return { error: "That port is not supported" };
  }

  if (isPrivateHost(parsed.hostname)) {
    return { error: "That address can't be imported" };
  }

  return { url: parsed };

}


/* ---- Fetch the page (size and time capped) ---- */

async function readCapped(response, maxBytes) {

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {

    const { done, value } = await reader.read();

    if (done) break;

    total += value.length;

    if (total > maxBytes) {
      await reader.cancel();
      break;
    }

    chunks.push(value);

  }

  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));

  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8").decode(merged);

}

async function fetchRecipePage(url) {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);

  try {

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DailyLifeRecipeImport/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      return { error: `The site returned an error (${response.status})` };
    }

    const finalUrl = response.url || url.toString();

    if (validateImportUrl(finalUrl).error) {
      return { error: "The link redirected somewhere that can't be imported" };
    }

    const type = response.headers.get("content-type") || "";

    if (!/html|xml/i.test(type)) {
      return { error: "That link isn't a web page" };
    }

    return { html: await readCapped(response, IMPORT_MAX_BYTES), finalUrl };

  } catch (error) {

    return {
      error: error?.name === "AbortError"
        ? "The site took too long to respond"
        : "Couldn't reach that site"
    };

  } finally {

    clearTimeout(timer);

  }

}


/* ---- Text helpers ---- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  frac12: "½", frac14: "¼", frac34: "¾", deg: "°", ndash: "–", mdash: "—",
  rsquo: "'", lsquo: "'", ldquo: "\"", rdquo: "\"", hellip: "…", eacute: "é"
};

function decodeEntities(value) {

  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => safeCodePoint(parseInt(d, 10), m))
    .replace(/&([a-z0-9]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);

}

function safeCodePoint(code, fallback) {

  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }

}

function stripTags(value) {

  return decodeEntities(
    String(value ?? "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|div)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  );

}

function cleanLine(value) {
  return stripTags(value).replace(/[ \t\u00a0]+/g, " ").trim();
}


/* ---- schema.org Recipe extraction ---- */

function findRecipeNode(node) {

  if (!node || typeof node !== "object") return null;

  if (Array.isArray(node)) {

    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }

    return null;

  }

  const types = [].concat(node["@type"] || []);

  if (types.some(t => typeof t === "string" && /(^|\/)Recipe$/i.test(t))) {
    return node;
  }

  if (node["@graph"]) return findRecipeNode(node["@graph"]);

  return null;

}

function extractRecipeNode(html) {

  const pattern =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = pattern.exec(html)) !== null) {

    let data = null;

    const raw = match[1].trim();

    try {
      data = JSON.parse(raw);
    } catch {
      try {
        data = JSON.parse(raw.replace(/[\u0000-\u001F]+/g, " "));
      } catch {
        continue;
      }
    }

    const found = findRecipeNode(data);

    if (found) return found;

  }

  return null;

}

function firstImageUrl(value, baseUrl) {

  if (!value) return null;

  if (Array.isArray(value)) {

    for (const item of value) {
      const found = firstImageUrl(item, baseUrl);
      if (found) return found;
    }

    return null;

  }

  const candidate =
    typeof value === "string" ? value : (value.url || value.contentUrl);

  if (typeof candidate !== "string") return null;

  try {

    const resolved = new URL(candidate, baseUrl);

    return /^https?:$/.test(resolved.protocol) ? resolved.toString() : null;

  } catch {

    return null;

  }

}

function parseYield(value) {

  for (const item of [].concat(value ?? [])) {

    const m = String(item ?? "").match(/\d+(?:[.,]\d+)?/);

    if (m) {

      const n = parseFloat(m[0].replace(",", "."));

      if (n > 0 && n <= 100) return n;

    }

  }

  return null;

}

function parseIsoMinutes(value) {

  const m = String(value || "").trim().match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );

  if (!m) return 0;

  return (
    (Number(m[1]) || 0) * 1440 +
    (Number(m[2]) || 0) * 60 +
    (Number(m[3]) || 0) +
    Math.round((Number(m[4]) || 0) / 60)
  );

}

function recipeMinutes(node) {

  const total = parseIsoMinutes(node.totalTime);

  const minutes = total || (
    parseIsoMinutes(node.prepTime) + parseIsoMinutes(node.cookTime)
  );

  return minutes > 0 && minutes <= 1440 ? minutes : null;

}

function collectSteps(value, out = []) {

  if (!value) return out;

  if (typeof value === "string") {

    stripTags(value)
      .split(/\n+/)
      .map(line => line.replace(/[ \t\u00a0]+/g, " ").trim())
      .filter(Boolean)
      .forEach(line => out.push(line));

    return out;

  }

  if (Array.isArray(value)) {
    value.forEach(item => collectSteps(item, out));
    return out;
  }

  if (typeof value === "object") {

    if (value.itemListElement) {
      collectSteps(value.itemListElement, out);
    } else if (value.text || value.name) {
      collectSteps(value.text || value.name, out);
    }

  }

  return out;

}


/* ---- Ingredient line parser ---- */

const UNICODE_FRACTIONS = {
  "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6"
};

const UNIT_ALIASES = {
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", tsps: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp",
  cup: "cup", cups: "cup",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  g: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can", tin: "can", tins: "can",
  pinch: "pinch", pinches: "pinch",
  bunch: "bunch", bunches: "bunch",
  handful: "handful", handfuls: "handful",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  sprig: "sprig", sprigs: "sprig",
  stick: "stick", sticks: "stick",
  pack: "pack", packs: "pack", packet: "pack", packets: "pack", package: "pack",
  jar: "jar", jars: "jar",
  portion: "portion", portions: "portion", serving: "portion", servings: "portion",
  dash: "dash", dashes: "dash",
  splash: "splash", splashes: "splash"
};

// units that can stand without a number ("a pinch of salt")
const LOOSE_UNITS = new Set(["pinch", "handful", "dash", "splash", "bunch", "sprig"]);

// "garlic cloves" -> unit clove, name garlic
const TRAILING_UNITS = new Set(["clove", "sprig", "stick", "slice"]);

// quantity (unit) -> base quantity (unit) used for the shopping list
const BASE_CONVERSIONS = {
  g: ["g", 1], kg: ["g", 1000],
  ml: ["ml", 1], l: ["ml", 1000],
  tsp: ["ml", 5], tbsp: ["ml", 15], cup: ["ml", 240],
  oz: ["g", 28.35], lb: ["g", 453.6]
};

const PREP_WORDS = new Set([
  "finely", "roughly", "thinly", "coarsely", "freshly", "lightly",
  "chopped", "diced", "sliced", "minced", "grated", "crushed", "peeled",
  "shredded", "melted", "softened", "beaten", "cubed", "halved",
  "trimmed", "rinsed", "drained", "toasted", "cooked"
]);

const KEY_STOP_WORDS = new Set([
  "large", "medium", "small", "big", "fresh", "ripe", "whole", "organic"
]);

function toNumber(text) {

  const t = String(text).trim().replace(",", ".");

  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);

  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);

  m = t.match(/^(\d+)\/(\d+)$/);

  if (m) return Number(m[1]) / Number(m[2]);

  const n = Number(t);

  return Number.isFinite(n) ? n : null;

}

function roundTo(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function toBaseQuantity(quantity, unit) {

  if (quantity === null || quantity === undefined) {
    return { baseQuantity: null, baseUnit: "" };
  }

  const conversion = BASE_CONVERSIONS[unit];

  if (conversion) {
    return {
      baseQuantity: roundTo(quantity * conversion[1], 2),
      baseUnit: conversion[0]
    };
  }

  return { baseQuantity: quantity, baseUnit: unit || "" };

}

function parseIngredientLine(rawLine) {

  const original = cleanLine(rawLine);

  let s = original;

  for (const [glyph, fraction] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.split(glyph).join(` ${fraction}`);
  }

  s = s
    .replace(/[–—]/g, "-")
    .replace(/^[\s•*\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  let optional = false;

  if (/\boptional\b/i.test(s)) {
    optional = true;
    s = s
      .replace(/\(\s*optional\s*\)/gi, "")
      .replace(/,?\s*\boptional\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // quantity (first number of a range is used)
  let quantity = null;

  const qm = s.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)(?:\s*-\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?))?\s*/
  );

  if (qm) {
    quantity = toNumber(qm[1]);
    s = s.slice(qm[0].length);
  } else if (/^(an?|one)\s+/i.test(s)) {
    quantity = 1;
    s = s.replace(/^(an?|one)\s+/i, "");
  }

  const notes = [];

  // parentheses, e.g. "1 (400g) can tomatoes"
  s = s.replace(/\(([^)]*)\)/g, (m, inner) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  }).replace(/\s+/g, " ").trim();

  // unit
  let unit = "";

  const um = s.match(/^([A-Za-z]+)\.?(?=\s|$|,)/);

  if (um) {

    const canonical = UNIT_ALIASES[um[1].toLowerCase()];

    if (canonical && (quantity !== null || LOOSE_UNITS.has(canonical))) {

      unit = canonical;

      if (quantity === null) quantity = 1;

      s = s.slice(um[0].length).trim();

    }

  }

  s = s.replace(/^of\s+/i, "");

  // comma -> preparation
  const comma = s.indexOf(",");

  if (comma >= 0) {
    const tail = s.slice(comma + 1).trim();
    if (tail) notes.push(tail);
    s = s.slice(0, comma).trim();
  }

  // leading preparation words, e.g. "finely chopped onion"
  const words = s.split(" ").filter(Boolean);
  const leading = [];

  while (
    words.length > 1 &&
    PREP_WORDS.has(words[0].toLowerCase()) &&
    // keep the canned product name "chopped tomatoes"
    !(words.length === 2 && /^tomatoes?$/i.test(words[1]))
  ) {
    leading.push(words.shift());
  }

  if (leading.length) notes.push(leading.join(" ").toLowerCase());

  // trailing unit words, e.g. "garlic cloves"
  if (!unit && words.length > 1) {

    const last = UNIT_ALIASES[words[words.length - 1].toLowerCase()];

    if (last && TRAILING_UNITS.has(last)) {
      unit = last;
      words.pop();
    }

  }

  let name = words.join(" ").replace(/[.;:]+$/, "").trim();

  if (!name) name = original;

  return {
    original,
    quantity,
    unit,
    name,
    preparation: notes.join(", "),
    optional
  };

}


/* ---- Ingredient matching ---- */

function singularWord(word) {

  if (word.length > 3 && word.endsWith("ies")) return word.slice(0, -3) + "y";

  if (word.length > 3 && /(o|ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);

  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us")
  ) return word.slice(0, -1);

  return word;

}

function ingredientKey(name) {

  const words = String(name || "")
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    .filter(word => word && !KEY_STOP_WORDS.has(word));

  if (!words.length) return "";

  words[words.length - 1] = singularWord(words[words.length - 1]);

  return words.join(" ");

}

async function getIngredientIndex(env) {

  return cachedData(INGREDIENT_INDEX_KEY, 600, async () => {

    const result = await fetchAllRecords(INGREDIENTS_TABLE_ID, env);

    if (result.error) {
      throw new Error("Airtable ingredients request failed");
    }

    return result.records
      .map(record => ({
        id: record.id,
        name: firstValue(record.fields || {}, ["Name"])
      }))
      .filter(item => item.name);

  });

}


/* ---- POST /api/import/preview ---- */

async function importPreview(request, env, corsHeaders) {

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, corsHeaders);
  }

  const checked = validateImportUrl(body?.url);

  if (checked.error) {
    return json({ error: checked.error }, 400, corsHeaders);
  }

  const page = await fetchRecipePage(checked.url);

  if (page.error) {
    return json({ error: page.error }, 422, corsHeaders);
  }

  const node = extractRecipeNode(page.html);

  if (!node) {

    return json({
      error: "Couldn't find a recipe on that page. Some sites hide their recipe data."
    }, 422, corsHeaders);

  }

  const title = cleanLine(node.name);

  const lines = []
    .concat(node.recipeIngredient || [])
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 80);

  if (!title || !lines.length) {

    return json({
      error: "The recipe on that page looks incomplete"
    }, 422, corsHeaders);

  }

  let index;

  try {
    index = await getIngredientIndex(env);
  } catch {
    return json({ error: "Couldn't read your Ingredients table" }, 502, corsHeaders);
  }

  const byKey = new Map(index.map(item => [ingredientKey(item.name), item]));

  const ingredients = lines.map(line => {

    const parsed = parseIngredientLine(line);

    const match = byKey.get(ingredientKey(parsed.name));

    return {
      ...parsed,
      isNew: !match,
      matchedName: match ? match.name : null
    };

  });

  const cuisine =
    [].concat(node.recipeCuisine || []).find(c => typeof c === "string") || null;

  return json({
    recipe: {
      title,
      sourceUrl: page.finalUrl,
      image: firstImageUrl(node.image, page.finalUrl),
      servings: parseYield(node.recipeYield),
      cookingTime: recipeMinutes(node),
      cuisine: cuisine ? cleanLine(cuisine) : null,
      steps: collectSteps(node.recipeInstructions).slice(0, 80),
      ingredients
    }
  }, 200, corsHeaders);

}


/* ---- POST /api/import/save ---- */

function importSaveError(message, status = 400) {
  return { error: message, status };
}

function validateImportRecipe(recipe) {

  if (!recipe || typeof recipe !== "object") {
    return importSaveError("Missing recipe");
  }

  const title = String(recipe.title || "").trim();

  if (!title || title.length > 200) {
    return importSaveError("A title (up to 200 characters) is required");
  }

  const numberOrNull = (value, max) => {

    if (value === null || value === undefined || value === "") return null;

    const n = Number(value);

    return n > 0 && n <= max ? n : undefined;

  };

  const servings = numberOrNull(recipe.servings, 100);
  const cookingTime = numberOrNull(recipe.cookingTime, 1440);

  if (servings === undefined) return importSaveError("Servings must be between 1 and 100");
  if (cookingTime === undefined) return importSaveError("Cooking time must be between 1 and 1440 minutes");

  let sourceUrl = null;

  if (recipe.sourceUrl) {

    const checked = validateImportUrl(recipe.sourceUrl);

    if (checked.error) return importSaveError("The source link isn't valid");

    sourceUrl = checked.url.toString();

  }

  let image = null;

  if (recipe.image) {

    const checked = validateImportUrl(recipe.image);

    image = checked.error ? null : checked.url.toString();

  }

  const steps = [].concat(recipe.steps || [])
    .map(step => String(step).trim())
    .filter(Boolean)
    .slice(0, 80);

  if (steps.some(step => step.length > 2000)) {
    return importSaveError("A method step is too long");
  }

  const lines = [];

  for (const raw of [].concat(recipe.ingredients || []).slice(0, 80)) {

    const name = String(raw?.name || "").trim();

    if (!name) continue;

    if (name.length > 120) return importSaveError("An ingredient name is too long");

    let quantity = null;

    if (raw.quantity !== null && raw.quantity !== undefined && raw.quantity !== "") {

      quantity = Number(raw.quantity);

      if (!(quantity >= 0 && quantity <= 100000)) {
        return importSaveError(`Check the quantity for "${name}"`);
      }

    }

    const unit = String(raw.unit || "").trim().slice(0, 20);

    lines.push({
      name,
      quantity,
      unit,
      preparation: String(raw.preparation || "").trim().slice(0, 200),
      optional: Boolean(raw.optional)
    });

  }

  if (!lines.length) return importSaveError("Add at least one ingredient");

  return {
    value: {
      title,
      servings,
      cookingTime,
      cuisine: recipe.cuisine ? String(recipe.cuisine).slice(0, 80) : null,
      sourceUrl,
      image,
      steps,
      lines
    }
  };

}

async function airtableBatchCreate(env, tableId, records) {

  const response = await airtableFetch(
    env,
    `https://api.airtable.com/v0/${BASE_ID}/${tableId}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ records, typecast: true })
    }
  );

  const data = await response.json();

  return { ok: response.ok, status: response.status, data };

}

async function importSave(request, env, corsHeaders) {

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, corsHeaders);
  }

  const checked = validateImportRecipe(body?.recipe);

  if (checked.error) {
    return json({ error: checked.error }, checked.status, corsHeaders);
  }

  const recipe = checked.value;

  /*
   * 1. Match ingredients, create the missing ones (batches of 10)
   */
  let index;

  try {
    index = await getIngredientIndex(env);
  } catch {
    return json({ error: "Couldn't read your Ingredients table" }, 502, corsHeaders);
  }

  const idByKey = new Map(index.map(item => [ingredientKey(item.name), item.id]));

  const toCreate = new Map();

  for (const line of recipe.lines) {

    const key = ingredientKey(line.name) || line.name.toLowerCase();

    if (!idByKey.has(key) && !toCreate.has(key)) {
      toCreate.set(key, line.name);
    }

  }

  const createKeys = [...toCreate.keys()];

  for (let i = 0; i < createKeys.length; i += 10) {

    const chunk = createKeys.slice(i, i + 10);

    const result = await airtableBatchCreate(
      env,
      INGREDIENTS_TABLE_ID,
      chunk.map(key => ({ fields: { "Name": toCreate.get(key) } }))
    );

    if (!result.ok) {

      return json({
        error: "Couldn't create new ingredients in Airtable",
        details: result.data
      }, 502, corsHeaders);

    }

    result.data.records.forEach((record, n) => idByKey.set(chunk[n], record.id));

  }

  const lineIds = recipe.lines.map(line =>
    idByKey.get(ingredientKey(line.name) || line.name.toLowerCase())
  );

  /*
   * 2. Create the recipe. If Airtable rejects Image or Cuisine
   *    (unknown field or select option), retry without them.
   */
  const fields = {
    "Name": recipe.title,
    "Ingredients": [...new Set(lineIds)],
    "Ingredients extracted": true
  };

  if (recipe.sourceUrl) fields["link"] = recipe.sourceUrl;
  if (recipe.steps.length) fields["Recipe text"] = recipe.steps.join("\n");
  if (recipe.servings !== null) fields["Default servings"] = recipe.servings;
  if (recipe.cookingTime !== null) fields["Cooking time (mins)"] = recipe.cookingTime;
  if (recipe.cuisine) fields["Cuisine"] = recipe.cuisine;
  if (recipe.image) fields["Image"] = [{ url: recipe.image }];

  const attempts = [[], ["Image"], ["Image", "Cuisine"]];

  let created = null;
  let lastError = null;
  const dropped = [];

  for (const drop of attempts) {

    const attemptFields = { ...fields };

    drop.forEach(name => delete attemptFields[name]);

    const result = await airtableBatchCreate(
      env,
      RECIPES_TABLE_ID,
      [{ fields: attemptFields }]
    );

    if (result.ok) {
      created = result.data.records[0];
      dropped.push(...drop.filter(name => fields[name] !== undefined));
      break;
    }

    lastError = result.data;

    if (result.status !== 422) break;

  }

  if (!created) {

    return json({
      error: "Couldn't save the recipe to Airtable",
      details: lastError
    }, 502, corsHeaders);

  }

  /*
   * 3. One Ingredients Quantities row per line (batches of 10)
   */
  let warning = dropped.length
    ? `Saved without: ${[...new Set(dropped)].join(", ")}`
    : null;

  for (let i = 0; i < recipe.lines.length; i += 10) {

    const records = recipe.lines.slice(i, i + 10).map((line, n) => {

      const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);

      const rowFields = {
        "Name": [
          line.name,
          line.quantity !== null ? formatQuantity(line.quantity) : "",
          line.unit
        ].filter(Boolean).join(" "),
        "Recipe": [created.id],
        "Ingredient": [lineIds[i + n]]
      };

      if (line.quantity !== null) rowFields["Original Quantity"] = line.quantity;
      if (line.unit) rowFields["Original Unit"] = line.unit;
      if (baseQuantity !== null) rowFields["Quantity (base)"] = baseQuantity;
      if (baseUnit) rowFields["Unit (base)"] = baseUnit;
      if (line.preparation) rowFields["Preparation"] = line.preparation;
      if (line.optional) rowFields["Optional?"] = true;

      return { fields: rowFields };

    });

    const result = await airtableBatchCreate(
      env,
      INGREDIENT_QUANTITIES_TABLE_ID,
      records
    );

    if (!result.ok) {

      warning = "The recipe was saved but some ingredient quantities could not be";

      break;

    }

  }

  await purgeCache(RECIPES_CACHE_KEY);
  await purgeCache(INGREDIENT_INDEX_KEY);

  return json({
    ok: true,
    recipeId: created.id,
    createdIngredients: createKeys.length,
    warning
  }, 201, corsHeaders);

}


/* =========================================================
   FAMILY LINKS
   =========================================================
   Private links kept as Worker secrets (never in site code).
   Only returned to callers that pass the app token.
   ========================================================= */

async function getLinks(env, corsHeaders) {

  let driveUrl = null;

  try {

    const parsed = new URL(String(env.FAMILY_DRIVE_URL || "").trim());

    if (parsed.protocol === "https:") driveUrl = parsed.toString();

  } catch {
    // not configured, or not a valid URL
  }

  return json({
    driveUrl
  }, 200, { ...corsHeaders, "Cache-Control": "no-store" });

}



/* =========================================================
   BUDGET (v0.4.0, read-only)
   =========================================================
   Airtable tables: Budget categories, Transactions (current +
   previous month, loaded from bank CSVs), Merchant rules and
   Budget history (one total per category per closed month).

   One cached payload (10 minutes, about 4 Airtable calls per
   refresh) holds everything the Overview, Categories and Trends
   screens need: totals, per-category spend and alerts, and the
   monthly trend with category drift.

   Spend rules:
   - Account "Amex": a positive amount is spend.
   - Any other account (HSBC): a negative amount is spend.
   - Credits and refunds are ignored (not netted off).
   - Rows ticked Exclude, and card payments / transfers matching
     BUDGET_TRANSFER_PATTERN, are ignored.
   - Category: the row's Category override, else the longest
     matching Merchant rule, else the category named "Other".
   ========================================================= */

const BUDGET_CACHE_KEY = "https://daily-life-cache.internal/budget-v1";

const BUDGET_TRANSFER_PATTERN =
  /american express|amex payment|payment received|payment[ -]+thank you|internal transfer|^transfer|^tfr\b/i;

const BUDGET_NEAR_RATIO = 0.8;     // "nearing budget" from 80% used
const BUDGET_RISING_RATIO = 1.15;  // 15%+ above the same point last month
const BUDGET_RISING_MIN_BASE = 20; // ignore tiny categories (GBP)
const BUDGET_RISING_MIN_RISE = 15; // and tiny rises (GBP)
const BUDGET_DRIFT_RISING = 0.15;
const BUDGET_DRIFT_FALLING = -0.10;
const BUDGET_TREND_MONTHS = 5;     // closed months shown in Trends

async function getBudget(env, corsHeaders) {

  return withCache(
    BUDGET_CACHE_KEY,
    CACHE_TTL.BUDGET,
    corsHeaders,
    async () => {

      const [categories, transactions, rules, history] = await Promise.all([
        fetchAllRecords(BUDGET_CATEGORIES_TABLE_ID, env),
        fetchAllRecords(BUDGET_TRANSACTIONS_TABLE_ID, env),
        fetchAllRecords(BUDGET_RULES_TABLE_ID, env),
        fetchAllRecords(BUDGET_HISTORY_TABLE_ID, env)
      ]);

      const failed =
        [categories, transactions, rules, history].find(r => r.error);

      if (failed) {
        return { error: "Airtable budget request failed", details: failed.error, status: 502 };
      }

      return {
        data: buildBudget(
          categories.records,
          transactions.records,
          rules.records,
          history.records,
          londonToday()
        )
      };

    }
  );

}

function londonToday() {

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

}

function shiftMonth(key, n) {

  const [y, m] = key.split("-").map(Number);

  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);

}

function daysInMonth(key) {

  const [y, m] = key.split("-").map(Number);

  return new Date(Date.UTC(y, m, 0)).getUTCDate();

}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function prepareBudgetCategories(categoryRecords, ruleRecords) {

  const categories = categoryRecords
    .map(record => ({
      id: record.id,
      name: String((record.fields || {})["Name"] || "").trim(),
      budget: Number((record.fields || {})["Monthly budget"]) || 0,
      order: Number((record.fields || {})["Order"]) || 999
    }))
    .filter(category => category.name)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const byId = new Map(categories.map(category => [category.id, category]));

  const fallback =
    categories.find(category => category.name.toLowerCase() === "other") || null;

  const rules = ruleRecords
    .map(record => ({
      text: String((record.fields || {})["Match text"] || "").trim().toLowerCase(),
      categoryId: ((record.fields || {})["Category"] || [])[0]
    }))
    .filter(rule => rule.text && byId.has(rule.categoryId))
    .sort((a, b) => b.text.length - a.text.length);

  return { categories, byId, fallback, rules };

}

/*
 * Transactions -> categorised spend rows (shared by the live
 * figures and the monthly roll-up). `months` lists every month
 * that has any transaction, spend or not.
 */
function categoriseSpend(transactionRecords, byId, rules, fallback) {

  const spend = [];
  const months = new Set();
  let unmatched = 0;
  let latest = null;

  for (const record of transactionRecords) {

    const fields = record.fields || {};

    const date = calendarDateOnly(fields["Date"]);

    if (date) months.add(date.slice(0, 7));
    if (date && (!latest || date > latest)) latest = date;

    if (fields["Exclude"]) continue;

    const amount = Number(fields["Amount"]);

    if (!date || !Number.isFinite(amount)) continue;

    const description = String(fields["Description"] || "");

    if (BUDGET_TRANSFER_PATTERN.test(description)) continue;

    const account = String(fields["Account"] || "");

    const out = account === "Amex" ? amount : -amount;

    if (!(out > 0)) continue;

    let category = byId.get((fields["Category override"] || [])[0]);

    if (!category) {

      const text = description.toLowerCase();
      const rule = rules.find(item => text.includes(item.text));

      category = rule ? byId.get(rule.categoryId) : null;

    }

    if (!category) {
      unmatched++;
      category = fallback;
    }

    if (!category) continue;

    spend.push({
      month: date.slice(0, 7),
      day: Number(date.slice(8, 10)),
      categoryId: category.id,
      amount: out
    });

  }

  return { spend, unmatched, months, latest };

}

function buildBudget(categoryRecords, transactionRecords, ruleRecords, historyRecords, today) {

  const { categories, byId, fallback, rules } =
    prepareBudgetCategories(categoryRecords, ruleRecords);

  const { spend, unmatched, months: rawMonthSet, latest } =
    categoriseSpend(transactionRecords, byId, rules, fallback);

  const month = today.slice(0, 7);
  const previous = shiftMonth(month, -1);
  const dayNow = Number(today.slice(8, 10));

  const sumByCategory = rows => {

    const totals = new Map();

    for (const row of rows) {
      totals.set(row.categoryId, (totals.get(row.categoryId) || 0) + row.amount);
    }

    return totals;

  };

  const current = sumByCategory(spend.filter(row => row.month === month));

  const previousSamePoint = sumByCategory(
    spend.filter(row => row.month === previous && row.day <= dayNow)
  );


  /*
   * Per-category status and alerts for the current month
   */
  const items = categories.map(category => {

    const spent = roundMoney(current.get(category.id) || 0);
    const before = roundMoney(previousSamePoint.get(category.id) || 0);

    const percent =
      category.budget > 0 ? Math.round(spent / category.budget * 100) : null;

    const alerts = [];

    if (category.budget > 0 && spent > category.budget) {
      alerts.push({ type: "over", amount: roundMoney(spent - category.budget) });
    } else if (category.budget > 0 && spent >= category.budget * BUDGET_NEAR_RATIO) {
      alerts.push({ type: "near", percent });
    }

    if (
      before >= BUDGET_RISING_MIN_BASE &&
      spent >= before * BUDGET_RISING_RATIO &&
      spent - before >= BUDGET_RISING_MIN_RISE
    ) {
      alerts.push({ type: "rising", percent: Math.round((spent / before - 1) * 100), previous: before });
    }

    return {
      id: category.id,
      name: category.name,
      budget: category.budget,
      spent,
      percent,
      previousSamePoint: before,
      alerts
    };

  });

  const severity = { over: 0, near: 1, rising: 2 };

  const alertItems = items
    .flatMap(item => item.alerts.map(alert => ({
      categoryId: item.id,
      category: item.name,
      ...alert
    })))
    .sort((a, b) => severity[a.type] - severity[b.type]);

  const totalBudget = roundMoney(items.reduce((n, item) => n + item.budget, 0));
  const totalSpent = roundMoney(items.reduce((n, item) => n + item.spent, 0));
  const totalBefore = roundMoney(items.reduce((n, item) => n + item.previousSamePoint, 0));


  /*
   * Closed months: Budget history rows, plus any month still held
   * as raw transactions (the previous month, until it is rolled up).
   */
  const closed = new Map();

  for (const record of historyRecords) {

    const fields = record.fields || {};
    const key = String(fields["Month"] || "").trim();
    const categoryId = (fields["Category"] || [])[0];
    const amount = Number(fields["Spent"]);

    if (!/^\d{4}-\d{2}$/.test(key) || key >= month || !byId.has(categoryId) || !Number.isFinite(amount)) continue;

    if (!closed.has(key)) closed.set(key, new Map());

    closed.get(key).set(categoryId, roundMoney(amount));

  }

  const historyKeys = [...closed.keys()].sort();

  const rawMonths = [...new Set(spend.map(row => row.month))]
    .filter(key => key < month && !closed.has(key));

  for (const key of rawMonths) {
    closed.set(
      key,
      new Map(
        [...sumByCategory(spend.filter(row => row.month === key))]
          .map(([id, amount]) => [id, roundMoney(amount)])
      )
    );
  }

  const closedKeys = [...closed.keys()].sort().slice(-BUDGET_TREND_MONTHS);

  const monthTotal = map => roundMoney([...map.values()].reduce((n, v) => n + v, 0));

  const months = closedKeys.map(key => ({
    month: key,
    total: monthTotal(closed.get(key)),
    partial: false
  }));

  months.push({ month, total: totalSpent, partial: true });


  /*
   * Drift: last closed month against the average of the three
   * closed months before it. Needs four closed months.
   */
  const drift = [];

  for (const category of categories) {

    const series = closedKeys.map(key => closed.get(key).get(category.id) || 0);

    if (!series.some(value => value > 0)) continue;

    const last = series[series.length - 1];
    let average = null;
    let change = null;
    let status = "na";

    if (series.length >= 4) {

      const base = series.slice(-4, -1);

      average = roundMoney(base.reduce((n, v) => n + v, 0) / 3);

      if (average < BUDGET_RISING_MIN_BASE && last < BUDGET_RISING_MIN_BASE) {
        status = "steady";
      } else {

        change = average > 0 ? (last - average) / average : null;

        status =
          change === null ? "na"
          : change >= BUDGET_DRIFT_RISING ? "rising"
          : change <= BUDGET_DRIFT_FALLING ? "falling"
          : "steady";

      }

    }

    drift.push({
      categoryId: category.id,
      name: category.name,
      series,
      last,
      average,
      change: change === null ? null : Math.round(change * 100),
      status
    });

  }

  return {
    month,
    today,
    dayOfMonth: dayNow,
    daysInMonth: daysInMonth(month),
    hasBudget: totalBudget > 0,
    transactionCount: spend.filter(row => row.month === month).length,
    unmatched,
    fallbackName: fallback ? fallback.name : null,
    lastTransaction: latest,
    rollup: {
      historyUpTo: historyKeys.length ? historyKeys[historyKeys.length - 1] : null,
      pendingMonths: [...rawMonthSet].filter(key => key < previous).sort(),
      needsOther: !fallback
    },
    totals: {
      budget: totalBudget,
      spent: totalSpent,
      remaining: roundMoney(totalBudget - totalSpent),
      percent: totalBudget > 0 ? Math.round(totalSpent / totalBudget * 100) : null,
      previousSamePoint: totalBefore,
      changePercent:
        totalBefore > 0 ? Math.round((totalSpent / totalBefore - 1) * 100) : null
    },
    categories: items,
    alerts: { count: alertItems.length, items: alertItems },
    trends: {
      closedMonths: closedKeys.length,
      months,
      drift,
      closedKeys
    }
  };

}



/* =========================================================
   BUDGET — SAVE CATEGORIES (v0.4.1)
   =========================================================
   Receives every category in display order. Existing ones
   (with an id) are updated; new ones are created. Nothing is
   deleted, so history and merchant rules stay linked. Airtable
   accepts 10 records per request, so a typical save is one call.
   ========================================================= */

const BUDGET_MAX_CATEGORIES = 30;

async function saveBudgetCategories(request, env, corsHeaders) {

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, corsHeaders);
  }

  const list = Array.isArray(body?.categories) ? body.categories : null;

  if (!list || !list.length || list.length > BUDGET_MAX_CATEGORIES) {
    return json({
      error: `Send between 1 and ${BUDGET_MAX_CATEGORIES} categories`
    }, 400, corsHeaders);
  }

  const names = new Set();
  const ids = new Set();
  const rows = [];

  for (const [index, item] of list.entries()) {

    const name = String(item?.name || "").trim();

    if (!name || name.length > 60) {
      return json({
        error: "Each category needs a name (up to 60 characters)"
      }, 400, corsHeaders);
    }

    if (names.has(name.toLowerCase())) {
      return json({ error: `"${name}" is used twice` }, 400, corsHeaders);
    }

    names.add(name.toLowerCase());

    const raw = item.budget === null || item.budget === undefined || item.budget === ""
      ? 0
      : Number(item.budget);

    if (!(raw >= 0 && raw <= 100000)) {
      return json({ error: `Check the budget for "${name}"` }, 400, corsHeaders);
    }

    const id = item.id ? String(item.id) : null;

    if (id && (!AIRTABLE_RECORD_ID.test(id) || ids.has(id))) {
      return json({ error: "Invalid category ID" }, 400, corsHeaders);
    }

    if (id) ids.add(id);

    rows.push({ id, name, budget: roundMoney(raw), order: index + 1 });

  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${BUDGET_CATEGORIES_TABLE_ID}`;

  const headers = {
    "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json"
  };

  const toFields = row => ({
    "Name": row.name,
    "Monthly budget": row.budget,
    "Order": row.order
  });

  const saved = [];
  let failure = null;

  const send = async (method, records) => {

    const response = await airtableFetch(env, url, {
      method,
      headers,
      body: JSON.stringify({ records, typecast: true })
    });

    const data = await response.json();

    if (!response.ok) {
      failure = data;
      return false;
    }

    saved.push(...(data.records || []));

    return true;

  };

  const updates = rows.filter(row => row.id);
  const creates = rows.filter(row => !row.id);

  for (let i = 0; i < updates.length && !failure; i += 10) {
    await send(
      "PATCH",
      updates.slice(i, i + 10).map(row => ({ id: row.id, fields: toFields(row) }))
    );
  }

  for (let i = 0; i < creates.length && !failure; i += 10) {
    await send(
      "POST",
      creates.slice(i, i + 10).map(row => ({ fields: toFields(row) }))
    );
  }

  // Purge even after a partial failure so the next read is fresh.
  await purgeCache(BUDGET_CACHE_KEY);

  if (failure) {
    return json({
      error: "Airtable budget save failed",
      details: failure
    }, 502, corsHeaders);
  }

  return json({
    ok: true,
    categories: saved
      .map(record => ({
        id: record.id,
        name: record.fields["Name"],
        budget: Number(record.fields["Monthly budget"]) || 0,
        order: Number(record.fields["Order"]) || 999
      }))
      .sort((a, b) => a.order - b.order)
  }, 200, corsHeaders);

}



/* =========================================================
   BUDGET ROLL-UP (v0.4.2)
   =========================================================
   Run by a Cloudflare cron trigger (monthly on the 2nd, with a
   retry on the 9th). Keeps the current and previous month as raw
   transactions. Every older month is:

     1. totalled per category, with the same rules as the live
        figures, and written to Budget history as "pending" rows
        (Month "2026-07*"; the app ignores them);
     2. only then deleted from Transactions;
     3. finalised: each pending row becomes the real history row
        (Month "2026-07"), or is added to the existing one if rows
        for that month were rolled up before (late-arriving data).

   Safe to re-run: a run that stops part-way is finished by the
   next one. A month is skipped, untouched, when its spend cannot
   be categorised (no category named "Other"), or when pending
   rows AND raw rows both exist (a delete stopped half-way; see
   the release notes for the manual fix).
   Cost: about 5 Airtable calls plus 1 per 10 rows deleted.
   ========================================================= */

const BUDGET_ROLLUP_MAX_MONTHS = 12;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function airtableDeleteRecords(env, tableId, ids) {

  const params = new URLSearchParams();

  ids.forEach(id => params.append("records[]", id));

  const response = await airtableFetch(
    env,
    `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params}`,
    {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${env.AIRTABLE_TOKEN}` }
    }
  );

  return { ok: response.ok, data: await response.json() };

}

async function airtableSend(env, tableId, method, records) {

  const response = await airtableFetch(
    env,
    `https://api.airtable.com/v0/${BASE_ID}/${tableId}`,
    {
      method,
      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ records, typecast: true })
    }
  );

  const data = await response.json();

  return {
    ok: response.ok && (data.records || []).length === records.length,
    data
  };

}

async function rollUpBudget(env, today = londonToday()) {

  if (!env.AIRTABLE_TOKEN) {
    return { status: "skipped", reason: "AIRTABLE_TOKEN is not configured" };
  }

  // Airtable allows about 5 requests a second per base
  const pause = () => sleep(Number(env.BUDGET_ROLLUP_PAUSE_MS ?? 250));

  // keep the current and previous month; everything before that is due
  const cutoff = `${shiftMonth(today.slice(0, 7), -1)}-01`;

  const [old, history] = await Promise.all([
    fetchAllRecords(
      BUDGET_TRANSACTIONS_TABLE_ID,
      env,
      {
        filterByFormula: `IS_BEFORE({Date}, '${cutoff}')`,
        "sort[0][field]": "Date",
        "sort[0][direction]": "asc"
      }
    ),
    fetchAllRecords(BUDGET_HISTORY_TABLE_ID, env)
  ]);

  if (old.error || history.error) {
    return { status: "failed", step: "read tables", details: old.error || history.error };
  }

  const finalRows = new Map();
  const pendingRows = new Map();

  for (const record of history.records) {

    const fields = record.fields || {};
    const month = String(fields["Month"] || "").trim();
    const categoryId = (fields["Category"] || [])[0];

    if (!categoryId) continue;

    if (/^\d{4}-\d{2}$/.test(month)) {
      finalRows.set(`${month}|${categoryId}`, record);
    } else if (/^\d{4}-\d{2}\*$/.test(month)) {
      pendingRows.set(`${month.slice(0, 7)}|${categoryId}`, record);
    }

  }

  const pendingMonths = new Set([...pendingRows.keys()].map(id => id.slice(0, 7)));

  const byMonth = new Map();

  for (const record of old.records) {

    const date = calendarDateOnly((record.fields || {})["Date"]);

    if (!date) continue;

    const key = date.slice(0, 7);

    if (!byMonth.has(key)) byMonth.set(key, []);

    byMonth.get(key).push(record);

  }

  // The newest month fetched may be cut off; leave it for the next run.
  if (old.truncated && byMonth.size) byMonth.delete([...byMonth.keys()].sort().pop());

  if (!byMonth.size && !pendingMonths.size) {
    return { status: "nothing due", cutoff };
  }

  const results = [];

  const finish = async () => {

    await purgeCache(BUDGET_CACHE_KEY);

    return {
      status: results.some(r => r.status === "failed") ? "failed" : "done",
      cutoff,
      months: results
    };

  };

  /*
   * Turn a month's pending rows into real history rows
   */
  const finalise = async key => {

    const renames = [];
    const merges = [];
    const leftovers = [];

    for (const [id, row] of pendingRows) {

      if (!id.startsWith(`${key}|`)) continue;

      const final = finalRows.get(`${key}|${id.slice(8)}`);

      if (final) {

        merges.push({
          id: final.id,
          fields: {
            "Spent": roundMoney(
              (Number(final.fields["Spent"]) || 0) +
              (Number(row.fields["Spent"]) || 0)
            )
          }
        });

        leftovers.push(row.id);

      } else {

        renames.push({ id: row.id, fields: { "Month": key } });

      }

    }

    for (const list of [renames, merges]) {

      for (let i = 0; i < list.length; i += 10) {

        const result = await airtableSend(env, BUDGET_HISTORY_TABLE_ID, "PATCH", list.slice(i, i + 10));

        if (!result.ok) return { ok: false, details: result.data };

        await pause();

      }

    }

    for (let i = 0; i < leftovers.length; i += 10) {

      const result = await airtableDeleteRecords(env, BUDGET_HISTORY_TABLE_ID, leftovers.slice(i, i + 10));

      if (!result.ok) return { ok: false, details: result.data };

      await pause();

    }

    return { ok: true };

  };

  /*
   * A. Finish months whose raw rows were already deleted
   */
  for (const key of [...pendingMonths].sort()) {

    if (byMonth.has(key)) {

      results.push({
        month: key,
        status: "needs review",
        reason: "pending history rows and transactions both exist"
      });

      continue;

    }

    const done = await finalise(key);

    if (!done.ok) {
      results.push({ month: key, status: "failed", step: "finalise history", details: done.details });
      return await finish();
    }

    results.push({ month: key, status: "finalised" });

  }

  /*
   * B. Roll up the months that are due
   */
  const due = [...byMonth.keys()]
    .sort()
    .filter(key => !pendingMonths.has(key))
    .slice(0, BUDGET_ROLLUP_MAX_MONTHS);

  if (!due.length) return await finish();

  const [categories, ruleRecords] = await Promise.all([
    fetchAllRecords(BUDGET_CATEGORIES_TABLE_ID, env),
    fetchAllRecords(BUDGET_RULES_TABLE_ID, env)
  ]);

  if (categories.error || ruleRecords.error) {
    results.push({ month: due[0], status: "failed", step: "read budget tables", details: categories.error || ruleRecords.error });
    return await finish();
  }

  const { byId, fallback, rules } =
    prepareBudgetCategories(categories.records, ruleRecords.records);

  for (const key of due) {

    const records = byMonth.get(key);

    const { spend, unmatched } =
      categoriseSpend(records, byId, rules, fallback);

    if (unmatched > 0 && !fallback) {

      results.push({
        month: key,
        status: "skipped",
        reason: "no category named Other for uncategorised spend",
        unmatched
      });

      continue;

    }

    const totals = new Map();

    for (const row of spend) {
      totals.set(row.categoryId, (totals.get(row.categoryId) || 0) + row.amount);
    }

    // 1. pending rows
    const creates = [...totals].map(([categoryId, total]) => ({
      fields: { "Month": `${key}*`, "Category": [categoryId], "Spent": roundMoney(total) }
    }));

    for (let i = 0; i < creates.length; i += 10) {

      const result = await airtableSend(env, BUDGET_HISTORY_TABLE_ID, "POST", creates.slice(i, i + 10));

      if (!result.ok) {
        results.push({ month: key, status: "failed", step: "write history", details: result.data });
        return await finish();
      }

      for (const record of result.data.records) {
        pendingRows.set(`${key}|${(record.fields["Category"] || [])[0]}`, record);
      }

      await pause();

    }

    // 2. delete the raw rows
    for (let i = 0; i < records.length; i += 10) {

      const result = await airtableDeleteRecords(
        env,
        BUDGET_TRANSACTIONS_TABLE_ID,
        records.slice(i, i + 10).map(record => record.id)
      );

      if (!result.ok) {
        results.push({ month: key, status: "failed", step: "delete transactions", details: result.data });
        return await finish();
      }

      await pause();

    }

    // 3. finalise
    const done = await finalise(key);

    if (!done.ok) {
      results.push({ month: key, status: "failed", step: "finalise history", details: done.details });
      return await finish();
    }

    results.push({
      month: key,
      status: "rolled up",
      categories: totals.size,
      deleted: records.length
    });

  }

  return await finish();

}
