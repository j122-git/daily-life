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
  TODOS: 45
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


    /*
     * POST /api/meal-plan
     */
    if (
      request.method === "POST" &&
      url.pathname === "/api/meal-plan"
    ) {

      return await createMealPlanEntry(
        request,
        env,
        corsHeaders
      );

    }


    /*
     * PATCH | DELETE /api/meal-plan/:id
     */
    if (
      (request.method === "PATCH" || request.method === "DELETE") &&
      url.pathname.startsWith("/api/meal-plan/")
    ) {

      const recordId =
        url.pathname.split("/")[3];

      if (!AIRTABLE_RECORD_ID.test(recordId || "")) {

        return json({
          error: "Invalid meal plan ID"
        }, 400, corsHeaders);

      }

      if (request.method === "PATCH") {

        return await updateMealPlanEntry(
          request,
          recordId,
          env,
          corsHeaders
        );

      }

      return await deleteMealPlanEntry(
        recordId,
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
   =========================================================
   One cached payload holds every recipe with its ingredients,
   read from three tables:

     Recipes              recipe details
     Ingredients Quantities  recipe + ingredient + quantity + unit
     Ingredients          ingredient names

   Airtable returns max 100 records per page, so each table is
   read page by page.
   ========================================================= */

const RECIPES_CACHE_KEY = "https://daily-life-cache.internal/recipes";

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

    const response = await fetch(
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

  } while (offset && pages < 10);

  return { records };

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
          normaliseRecipe(record, linesByRecipe.get(record.id) || [])
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
   MEAL PLAN — CREATE
   ========================================================= */

async function createMealPlanEntry(
  request,
  env,
  corsHeaders
) {

  let body;

  try {

    body = await request.json();

  } catch {

    return json({
      error: "Invalid JSON"
    }, 400, corsHeaders);

  }

  const parsed = mealPlanFields(body || {}, true);

  if (parsed.error) {

    return json({
      error: parsed.error
    }, 400, corsHeaders);

  }

  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${MEAL_PLAN_TABLE_ID}`,
    {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        fields: parsed.fields,
        typecast: true
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {

    return json({
      error: "Airtable meal plan creation failed",
      details: data
    }, 502, corsHeaders);

  }

  await purgeCache(MEAL_PLAN_CACHE_KEY);

  return json({
    ok: true,
    entry: normaliseMealPlanRecord(data)
  }, 201, corsHeaders);

}


/* =========================================================
   MEAL PLAN — UPDATE
   ========================================================= */

async function updateMealPlanEntry(
  request,
  recordId,
  env,
  corsHeaders
) {

  let body;

  try {

    body = await request.json();

  } catch {

    return json({
      error: "Invalid JSON"
    }, 400, corsHeaders);

  }

  const parsed = mealPlanFields(body || {}, false);

  if (parsed.error) {

    return json({
      error: parsed.error
    }, 400, corsHeaders);

  }

  if (Object.keys(parsed.fields).length === 0) {

    return json({
      error: "No recognised fields to update"
    }, 400, corsHeaders);

  }

  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${MEAL_PLAN_TABLE_ID}/${recordId}`,
    {
      method: "PATCH",

      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        fields: parsed.fields,
        typecast: true
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {

    return json({
      error: "Airtable meal plan update failed",
      details: data
    }, 502, corsHeaders);

  }

  await purgeCache(MEAL_PLAN_CACHE_KEY);

  return json({
    ok: true,
    entry: normaliseMealPlanRecord(data)
  }, 200, corsHeaders);

}


/* =========================================================
   MEAL PLAN — DELETE
   ========================================================= */

async function deleteMealPlanEntry(
  recordId,
  env,
  corsHeaders
) {

  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${MEAL_PLAN_TABLE_ID}/${recordId}`,
    {
      method: "DELETE",

      headers: {
        "Authorization": `Bearer ${env.AIRTABLE_TOKEN}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {

    return json({
      error: "Airtable meal plan deletion failed",
      details: data
    }, 502, corsHeaders);

  }

  await purgeCache(MEAL_PLAN_CACHE_KEY);

  return json({
    ok: true,
    deleted: true,
    recordId
  }, 200, corsHeaders);

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

    recipeName: null,

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
        return { error: "Airtable todos request failed", details: data, status: 502 };
      }


      const todos =
        (data.records || []).map(
          normaliseTodo
        );


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
      const response = await fetch(url, {
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


  await purgeCache(TODOS_CACHE_KEY);


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


  await purgeCache(TODOS_CACHE_KEY);


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


  await purgeCache(TODOS_CACHE_KEY);


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
   * 60s on top of this. This is separate from the Airtable edge
   * cache above — Google's ICS feed doesn't count against Airtable's
   * monthly API budget at all.
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
