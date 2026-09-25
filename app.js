/* Daily Life frontend — Cloudflare Worker + Airtable */
const API=(window.DAILY_LIFE_API||"https://daily-life.thibaud-guerrero.workers.dev/").replace(/\/$/,"");
let APP_TOKEN=localStorage.getItem("dailyLifeAppToken")||"";
let state={recipes:[],todos:[],mealPlan:[],todoOptions:{categories:[],statuses:[]}};
const CACHE_TTL=60*1000;
const cacheMeta={recipes:{loaded:false,at:0,promise:null},todos:{loaded:false,at:0,promise:null},mealPlan:{loaded:false,at:0,promise:null},"todo-options":{loaded:false,at:0,promise:null}};
const isFresh=k=>cacheMeta[k].loaded&&(Date.now()-cacheMeta[k].at)<CACHE_TTL;
function markLoaded(k){cacheMeta[k].loaded=true;cacheMeta[k].at=Date.now()}
function invalidate(k){cacheMeta[k].loaded=false;cacheMeta[k].at=0}

function hasAppToken(){return Boolean(APP_TOKEN&&APP_TOKEN.trim())}
function saveAppToken(token){
  APP_TOKEN=String(token||"").trim();
  if(APP_TOKEN)localStorage.setItem("dailyLifeAppToken",APP_TOKEN);
  else localStorage.removeItem("dailyLifeAppToken");
}
function removeAppToken(){
  APP_TOKEN="";
  localStorage.removeItem("dailyLifeAppToken");
}

async function api(path,options={}){
  if(!hasAppToken()) throw Error("No app token configured");
  const r=await fetch(API+path,{...options,headers:{"Content-Type":"application/json","X-App-Token":APP_TOKEN,...(options.headers||{})}});
  let d=null; try{d=await r.json()}catch{}
  if(!r.ok) throw Error(d?.error||`Request failed (${r.status})`);
  return d;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function iso(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function today(){return iso()}
function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);return iso(d)}

// Task due dates are calendar dates, not timestamps. Keep them as YYYY-MM-DD
// strings so timezone conversions cannot move a task by one day.
function todoDate(value){
  if(!value)return null;
  const match=String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?match[1]:null;
}
function dateLabel(value){
  const raw=todoDate(value);
  if(!raw)return value?String(value):"";
  const [y,m,d]=raw.split("-").map(Number);
  const date=new Date(y,m-1,d);
  return Number.isNaN(date.getTime())?raw:date.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
}
function bucket(t){
  const due=todoDate(t?.due);
  if(!due)return"upcoming";
  if(due===today())return"today";
  if(due===tomorrow())return"tomorrow";
  return"upcoming";
}
function img(r,cls="thumb"){return r.image?`<img class="${cls}" src="${esc(r.image)}" alt="" loading="lazy">`:`<div class="${cls}" style="display:grid;place-items:center;font-size:24px">🍲</div>`}
function nav(a){return `<nav class="bottom"><button class="nav ${a==="home"?"active":""}" onclick="show('home')"><span class="ni">⌂</span>Home</button><button class="nav ${a==="recipes"?"active":""}" onclick="show('recipes')"><span class="ni">♨</span>Recipes</button><button class="nav ${a==="todo"?"active":""}" onclick="show('todo')"><span class="ni">✓</span>Lists</button><button class="nav" onclick="toast('More coming soon')"><span class="ni">•••</span>More</button></nav>`}
function header(title="",back=false){return `<header class="header">${back?`<button class="back" onclick="show('home')">‹</button>`:`<div class="logo">Daily Life</div>`}<h1 class="screen-title">${back?esc(title):""}</h1><button class="avatar" onclick="show('token')" aria-label="Connection settings" title="Connection settings">🔑</button></header>`}
async function load(kind,{force=false,background=false}={}){
  const meta=cacheMeta[kind];
  if(!force&&meta.loaded){if(!isFresh(kind)&&!meta.promise)meta.promise=load(kind,{force:true,background:true}).finally(()=>meta.promise=null);return state}
  if(meta.promise)return meta.promise;
  const path=kind==="recipes"?"/api/recipes":kind==="todos"?"/api/todos":kind==="todo-options"?"/api/todo-options":"/api/meal-plan";
  const request=(async()=>{try{
    const d=await api(path);
    if(kind==="recipes")state.recipes=d.recipes||[];
    if(kind==="todos")state.todos=(d.todos||[]).map(t=>({...t,due:todoDate(t.due),bucket:bucket(t)}));
    if(kind==="todo-options")state.todoOptions={categories:d.categories||[],statuses:d.statuses||[]};
    if(kind==="mealPlan")state.mealPlan=d.mealPlan||[];
    markLoaded(kind); return d;
  }catch(e){
    if(kind==="todo-options"){state.todoOptions={categories:[],statuses:[]};markLoaded(kind);return {categories:[],statuses:[],fallback:true}}
    if(background&&meta.loaded){console.warn(`Background refresh failed for ${kind}.`,e);return state}
    throw e;
  }})();
  meta.promise=request; try{return await request}finally{if(meta.promise===request)meta.promise=null}
}
async function all({force=false}={}){await Promise.all([load("recipes",{force}),load("todos",{force}),load("mealPlan",{force})]);return state}
function refreshDataInBackground(kinds=["recipes","todos","mealPlan"]){for(const k of kinds)if(cacheMeta[k].loaded&&!cacheMeta[k].promise)load(k,{force:true,background:true})}
function recipeFor(item){return state.recipes.find(r=>r.id===item?.recipeId)}
function week(){const out=[];const d=new Date();const wd=d.getDay();d.setDate(d.getDate()+(wd===0?-6:1-wd));for(let i=0;i<7;i++){const x=new Date(d);x.setDate(d.getDate()+i);const ds=iso(x), meals=state.mealPlan.filter(m=>m.date===ds), m=meals.find(x=>/dinner/i.test(x.meal||""))||meals[0], r=recipeFor(m);out.push(`<div class="day d${i%4+1}"><small>${x.toLocaleDateString("en-GB",{weekday:"short"})}</small><b>${esc(r?.name||m?.recipeName||"—")}</b></div>`)}return out.join("")}
function connectionModal(success,title,message){
  return `<div class="modal-backdrop" id="connection-modal" role="presentation">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-modal-title">
      <div class="modal-icon ${success?"success":"failure"}">${success?"✓":"×"}</div>
      <div class="eyebrow">${success?"Connected":"Connection failed"}</div>
      <h2 id="connection-modal-title">${esc(title)}</h2>
      <p class="sub">${esc(message)}</p>
      <button class="primary-button" onclick="closeConnectionModal()">Done</button>
      ${success?`<button class="text-button" onclick="closeConnectionModal();show('home')">Continue to Daily Life</button>`:""}
    </div>
  </div>`
}

function closeConnectionModal(){
  document.getElementById("connection-modal")?.remove();
}

async function testConnection(){
  const input=document.getElementById("app-token");
  const token=input?.value?.trim()||APP_TOKEN;

  if(!token){
    toast("Enter your app token first");
    input?.focus();
    return;
  }

  saveAppToken(token);

  const button=document.getElementById("test-connection");
  if(button){
    button.disabled=true;
    button.textContent="Testing connection…";
  }

  try{
    await api("/api/recipes");
    document.body.insertAdjacentHTML("beforeend",
      connectionModal(
        true,
        "Connection successful",
        "Daily Life is connected to your family data. Your token works."
      )
    );
  }catch(e){
    removeAppToken();

    const unauthorised=/unauthorised|unauthorized|401/i.test(e?.message||"");
    document.body.insertAdjacentHTML("beforeend",
      connectionModal(
        false,
        unauthorised ? "Token not recognised" : "Could not connect",
        unauthorised
          ? "The app token was rejected. Check the token and try again."
          : "We couldn't reach the Daily Life server. Check your Worker URL and connection, then try again."
      )
    );
  }finally{
    if(button){
      button.disabled=false;
      button.textContent="Test connection";
    }
  }
}

async function saveAndConnect(){
  const input=document.getElementById("app-token");
  const token=input?.value?.trim()||"";

  if(!token){
    toast("Please enter your app token");
    input?.focus();
    return;
  }

  saveAppToken(token);

  try{
    await api("/api/recipes");
    await show("home");
    toast("Connected");
  }catch(e){
    removeAppToken();

    const unauthorised=/unauthorised|unauthorized|401/i.test(e?.message||"");
    document.getElementById("app").insertAdjacentHTML(
      "beforeend",
      connectionModal(
        false,
        unauthorised ? "Token not recognised" : "Could not connect",
        unauthorised
          ? "The app token was rejected. Check the token and try again."
          : "We couldn't reach the Daily Life server. Check your Worker URL and connection, then try again."
      )
    );
  }
}

function tokenScreen(){
  return `<div class="shell">
    <header class="header">
      <button class="back" onclick="${hasAppToken()?"show('home')":"toast('Enter your token to connect')"}" aria-label="Back">‹</button>
      <h1 class="screen-title">Connection</h1>
      <div style="width:38px"></div>
    </header>

    <main class="page token-page">

      <div class="token-illustration" aria-hidden="true">
        <span class="token-shape mint"></span>
        <span class="token-shape lilac"></span>
        <span class="token-shape yellow"></span>
        <span class="token-key">⚿</span>
      </div>

      <div class="eyebrow">Daily Life</div>

      <h1 class="token-title">Enter your app token</h1>

      <p class="token-intro">
        Your token connects Daily Life to your family data through your Cloudflare Worker.
      </p>

      <label class="token-label" for="app-token">App token</label>

      <div class="token-input-wrap">
        <span aria-hidden="true">⚿</span>
        <input
          id="app-token"
          type="password"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          value="${esc(APP_TOKEN)}"
          placeholder="Paste your app token here"
        >
      </div>

      <button id="save-connect" class="primary-button" onclick="saveAndConnect()">
        Save &amp; Connect <span aria-hidden="true">→</span>
      </button>

      <button id="test-connection" class="secondary-button" onclick="testConnection()">
        <span aria-hidden="true">◉</span> Test connection
      </button>

      <div class="help-divider">
        <span></span>
        <b>Need help?</b>
        <span></span>
      </div>

      <div class="help-card">
        <div class="help-icon" aria-hidden="true">i</div>
        <div>
          <strong>Where do I get my token?</strong>
          <p>
            Use the APP_TOKEN configured in your Daily Life Cloudflare Worker.
          </p>
        </div>
      </div>

      <p class="token-footnote">
        The token is stored locally on this device and sent to your Worker as an
        <code>X-App-Token</code> header. Your Airtable token is never stored in the app.
      </p>

      ${hasAppToken()?`
        <button class="remove-token" onclick="removeAppToken();show('token')">
          Remove token from this device
        </button>
      `:""}

    </main>
  </div>`
}

function home(){const meal=state.mealPlan.find(m=>m.date===today()),r=recipeFor(meal)||state.recipes[0],ts=state.todos.filter(t=>t.bucket==="today"&&t.status!=="Done").slice(0,3);return `<div class="shell">${header()}<main class="page"><div class="eyebrow">Good morning,</div><div class="hello">The Wilsons ☀️</div><div class="modules"><button class="module m-meal" onclick="show('recipes')"><div class="ico">♜</div><div class="module-title">Meal plan</div><div class="module-sub">See what's for dinner<span class="chev">›</span></div></button><button class="module m-todo" onclick="show('todo')"><div class="ico">✓</div><div class="module-title">To do</div><div class="module-sub">${state.todos.filter(t=>t.status!=="Done").length} tasks<span class="chev">›</span></div></button><button class="module m-shop" onclick="toast('Shopping list coming next')"><div class="ico">🛒</div><div class="module-title">Shopping</div><div class="module-sub">Coming soon<span class="chev">›</span></div></button><button class="module m-family" onclick="toast('Family coming next')"><div class="ico">♧</div><div class="module-title">Family</div><div class="module-sub">Coming soon<span class="chev">›</span></div></button></div><div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>${r?`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="eyebrow">${esc(meal?.meal||"Meal")}</div><div class="title">${esc(r.name)}</div></div><div class="chev">›</div></div>`:`<div class="card" style="padding:18px"><div class="sub">Nothing planned for today.</div></div>`}${ts.map(t=>`<div class="card row" onclick="show('todo')"><button class="check" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.category||"")}</div></div><div class="chev">›</div></div>`).join("")}<div class="section-head"><h2>This week's meal plan</h2><button class="link" onclick="show('recipes')">View all</button></div><div class="meal-week">${week()}</div></main>${nav("home")}</div>`}
function recipes(){return `<div class="shell">${header("Recipes",true)}<main class="page"><div class="filterbar"><span class="pill active">All</span><span class="pill">Quick</span><span class="pill">Family</span><span class="pill">Favourites</span></div>${state.recipes.map(r=>`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${esc(r.cuisine||"")}${r.cookingTime?` · ${esc(r.cookingTime)}`:""}${r.servings?` · ${esc(r.servings)} servings`:""}</div></div><div class="chev">›</div></div>`).join("")||'<div class="empty">No recipes found.</div>'}</main>${nav("recipes")}</div>`}
async function recipe(id){const cached=state.recipes.find(x=>x.id===id);if(cached&&(cached.ingredients||cached.recipeText||cached.notes))return renderRecipe(cached);const d=await api(`/api/recipes/${encodeURIComponent(id)}`),r=d.recipe;if(!r)throw Error("Recipe not found");const i=state.recipes.findIndex(x=>x.id===id);if(i>=0)state.recipes[i]={...state.recipes[i],...r};else state.recipes.push(r);return renderRecipe(state.recipes.find(x=>x.id===id)||r)}
function renderRecipe(r){const ing=Array.isArray(r.ingredients)?r.ingredients:[];return `<div class="shell">${header(r.name,true)}<main class="page"><article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}" alt="">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px">🍲</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>◷ ${esc(r.cookingTime)}</span>`:""}${r.servings?`<span>♜ ${esc(r.servings)} servings</span>`:""}${r.difficulty?`<span>♧ ${esc(r.difficulty)}</span>`:""}</div>${r.notes||r.recipeText?`<p class="desc">${esc(r.notes||r.recipeText)}</p>`:""}${ing.length?`<h3>Ingredients</h3>${ing.map(x=>`<div class="ingredient"><span class="circle"></span>${esc(typeof x==="string"?x:JSON.stringify(x))}</div>`).join("")}`:""}<button class="module m-meal" style="width:100%;margin-top:14px;padding:14px" onclick="toast('Meal-plan editing coming next')">▣ &nbsp; Add to meal plan</button></div></article></main></div>`}
let todoFilter="All";
let todoSort="desc";

function todoStatusClass(status){
  const v=String(status||"To do").toLowerCase();
  return v.includes("done")?"done":v.includes("progress")?"progress":"todo";
}
function nextTodoStatus(status){
  const v=String(status||"To do").toLowerCase();
  if(v.includes("done")) return "To do";
  if(v.includes("progress")) return "Done";
  return "In progress";
}
function statusLabel(status){
  const c=todoStatusClass(status);
  return c==="done"?"Done":c==="progress"?"In progress":"To do";
}
function filteredTodos(){
  let ts=[...state.todos];
  if(todoFilter==="Today") ts=ts.filter(t=>bucket(t)==="today");
  else if(todoFilter==="Upcoming") ts=ts.filter(t=>todoStatusClass(t.status)!=="done" && (bucket(t)==="tomorrow"||bucket(t)==="upcoming"));
  else if(todoFilter==="Done") ts=ts.filter(t=>todoStatusClass(t.status)==="done");
  ts.sort((a,b)=>{
    const ad=todoDate(a.due)||"9999-12-31";
    const bd=todoDate(b.due)||"9999-12-31";
    const cmp=ad.localeCompare(bd);
    return todoSort==="asc"?cmp:-cmp;
  });
  return ts;
}
function todoForm(t=null){
  const cats=state.todoOptions.categories.length?state.todoOptions.categories:[...new Set(state.todos.map(x=>x.category).filter(Boolean))];
  const statuses=state.todoOptions.statuses.length?state.todoOptions.statuses:["To do","In progress","Done"];
  const category=t?.category||cats[0]||"";
  const status=t?.status||"To do";
  return `<div class="modal-backdrop" id="todo-form-modal">
    <div class="modal todo-form" role="dialog" aria-modal="true" aria-labelledby="todo-form-title">
      <div class="eyebrow">${t?"Edit task":"New task"}</div>
      <h2 id="todo-form-title">${t?"Edit to do":"Add a to do"}</h2>
      <label class="form-label" for="todo-task">Task</label>
      <input class="form-input" id="todo-task" maxlength="200" value="${esc(t?.task||"")}" placeholder="What needs doing?">
      <label class="form-label" for="todo-due">Due date</label>
      <input class="form-input" id="todo-due" type="date" value="${esc(t?.due||today())}">
      <label class="form-label" for="todo-category">Category</label>
      <select class="form-input" id="todo-category"><option value="">No category</option>${cats.map(c=>`<option value="${esc(c)}" ${c===category?"selected":""}>${esc(c)}</option>`).join("")}</select>
      <label class="form-label" for="todo-status">Status</label>
      <select class="form-input" id="todo-status">${statuses.map(x=>`<option value="${esc(x)}" ${String(x).toLowerCase()===String(status).toLowerCase()?"selected":""}>${esc(x)}</option>`).join("")}</select>
      <div class="form-actions"><button class="secondary-button" onclick="closeTodoForm()">Cancel</button><button class="primary-button" onclick="saveTodo('${esc(t?.id||"")}')">${t?"Save changes":"Add task"}</button></div>
      ${t?`<button class="danger-button" onclick="deleteTodo('${esc(t.id)}')">Delete task</button>`:""}
    </div>
  </div>`;
}
function openTodoForm(t=null){document.body.insertAdjacentHTML("beforeend",todoForm(t));setTimeout(()=>document.getElementById("todo-task")?.focus(),0)}
function closeTodoForm(){document.getElementById("todo-form-modal")?.remove()}
async function saveTodo(id){
  const task=document.getElementById("todo-task")?.value.trim();
  const due=document.getElementById("todo-due")?.value||null;
  const category=document.getElementById("todo-category")?.value||null;
  const status=document.getElementById("todo-status")?.value||"To do";
  if(!task){toast("Enter a task");return}
  try{
    const body={task,due:todoDate(due),category,status};
    if(id){const i=state.todos.findIndex(x=>x.id===id);if(i>=0)state.todos[i]={...state.todos[i],...body,bucket:bucket({...state.todos[i],...body})};closeTodoForm();toast("Task updated");show("todo");try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(body)});markLoaded("todos")}catch(e){await load("todos",{force:true});show("todo");toast("Couldn't save task: "+e.message)}}else{try{const d=await api("/api/todos",{method:"POST",body:JSON.stringify(body)});if(d?.todo)state.todos.unshift({...d.todo,bucket:bucket(d.todo)});else invalidate("todos");closeTodoForm();toast("Task added");show("todo")}catch(e){toast("Couldn't save task: "+e.message)}}
  }catch(e){toast("Couldn't save task: "+e.message)}
}
function todo(){
  const ts=filteredTodos();
  const groups=[ ["today","Today"],["tomorrow","Tomorrow"],["upcoming","Upcoming"] ];
  let sections="";
  for(const [b,label] of groups){
    const group=ts.filter(t=>t.bucket===b);
    if(!group.length) continue;
    sections += `<div class="todo-group"><b>${label}</b><span>${group.filter(t=>todoStatusClass(t.status)!=="done").length} remaining</span></div>`;
    for(const t of group){
      const sc=todoStatusClass(t.status);
      const tag=t.category?`<span class="tag ${esc(t.category)}">${esc(t.category)}</span>`:"";
      const due=t.due?`<div class="sub">${esc(dateLabel(t.due))}</div>`:"";
      const stateText=sc==="progress"?`<span class="status-text">In progress</span>`:"";
      sections += `<div class="card row todo-row">
        <button aria-label="Change task status" class="check ${sc}" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button>
        <div class="grow" onclick="editTodo('${esc(t.id)}')" style="cursor:pointer">
          <div class="title ${sc==="done"?"completed":""}">${esc(t.task)}</div>${stateText}${tag}${due}
        </div>
        <button class="chev" onclick="editTodo('${esc(t.id)}')">›</button></div>`;
    }
  }
  return `<div class="shell">${header("To do",false)}<main class="page"><div style="display:flex;justify-content:space-between;align-items:center"><h1 class="screen-title">To do</h1><button class="plus" onclick="openTodoForm()">+</button></div><div class="filterbar">${["All","Today","Upcoming","Done"].map(x=>`<button class="pill ${todoFilter===x?"active":""}" onclick="todoFilter='${x}';show('todo')">${x}</button>`).join("")}</div><div class="todo-toolbar"><span>Sort by due date</span><button class="sort-button" onclick="todoSort=todoSort==='desc'?'asc':'desc';show('todo')">${todoSort==='desc'?"Newest first ↓":"Oldest first ↑"}</button></div>${sections||'<div class="empty">No tasks found.</div>'}</main>${nav("todo")}</div>`;
}
function editTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;openTodoForm(t);load("todo-options")}
async function toggleTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;const previous=t.status,status=nextTodoStatus(previous);t.status=status;show("todo");try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status})});markLoaded("todos")}catch(e){t.status=previous;show("todo");toast("Couldn't update task: "+e.message)}}
async function deleteTodo(id){if(!confirm("Delete this task?"))return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"DELETE"});state.todos=state.todos.filter(x=>x.id!==id);markLoaded("todos");closeTodoForm();toast("Task deleted");show("todo")}catch(e){toast("Couldn't delete task: "+e.message)}}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
function errorScreen(e){return `<div class="shell">${header()}<main class="page"><div class="card" style="padding:20px"><div class="eyebrow">Connection problem</div><h2>Daily Life couldn't reach the Worker.</h2><p class="sub">${esc(e?.message||"Unknown error")}</p><p class="sub">Check DAILY_LIFE_API and DAILY_LIFE_APP_TOKEN in app.js.</p><button class="module m-meal" style="width:100%;margin-top:14px;padding:14px" onclick="show('home')">Try again</button></div></main>${nav("home")}</div>`}
async function show(page,id){
  scrollTo(0,0);const app=document.getElementById("app");
  try{
    if(page==="token"){app.innerHTML=tokenScreen();return}
    if(!hasAppToken()){app.innerHTML=tokenScreen();return}
    if(page==="home"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await all()}
    else if(page==="recipes"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("recipes")}
    else if(page==="todo"&&!cacheMeta.todos.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("todos")}
    let h;if(page==="home")h=home();else if(page==="recipes")h=recipes();else if(page==="recipe")h=await recipe(id);else h=todo();
    app.innerHTML=h;
    if(page==="home")refreshDataInBackground(["recipes","todos","mealPlan"]);
    if(page==="recipes"||page==="recipe")refreshDataInBackground(["recipes"]);
    if(page==="todo"){refreshDataInBackground(["todos"]);if(!cacheMeta["todo-options"].loaded)load("todo-options",{background:true})}
  }catch(e){console.error(e);app.innerHTML=errorScreen(e)}
}
if(!window.location.hash)show("home");
