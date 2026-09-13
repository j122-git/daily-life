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
   NORMALISE TODO
   ========================================================= */

function normaliseTodo(record) {

  const fields =
    record.fields || {};


  const due =
    firstValue(
      fields,
      [
        "Due"
      ]
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

  if (!due) {
    return "upcoming";
  }


  const dueDate =
    new Date(`${due}T00:00:00`);


  if (Number.isNaN(dueDate.getTime())) {
    return "upcoming";
  }


  const today =
    new Date();

  today.setHours(
    0, 0, 0, 0
  );


  const tomorrow =
    new Date(today);

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );


  if (
    dueDate.getTime() ===
    today.getTime()
  ) {

    return "today";

  }


  if (
    dueDate.getTime() ===
    tomorrow.getTime()
  ) {

    return "tomorrow";

  }


  return "upcoming";

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
      body.due;

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
      body.due || null;

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
