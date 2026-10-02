/* Daily Life frontend — Cloudflare Worker + Airtable */
const API=(window.DAILY_LIFE_API||"https://daily-life.thibaud-guerrero.workers.dev/").replace(/\/$/,"");
let APP_TOKEN=localStorage.getItem("dailyLifeAppToken")||"";
let state={recipes:[],todos:[],mealPlan:[],events:[],todoOptions:{categories:[],statuses:[]}};
const CACHE_TTL=60*1000;
const cacheMeta={recipes:{loaded:false,at:0,promise:null},todos:{loaded:false,at:0,promise:null},mealPlan:{loaded:false,at:0,promise:null},events:{loaded:false,at:0,promise:null},"todo-options":{loaded:false,at:0,promise:null}};
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

function dayPeriod(){const h=new Date().getHours();if(h>=5&&h<12)return"morning";if(h>=12&&h<17)return"afternoon";if(h>=17&&h<21)return"evening";return"night"}
function greetingText(p){return{morning:"Good morning",afternoon:"Good afternoon",evening:"Good evening",night:"Good night"}[p]||"Hello"}
function greetingIcon(p){return{morning:"sunrise",afternoon:"sun",evening:"sunset",night:"moon"}[p]||"sun"}
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
  if(due<today()&&todoStatusClass(t?.status)!=="done")return"overdue";
  return"upcoming";
}
// Whole-day difference between a YYYY-MM-DD due date and today, ignoring time-of-day.
function daysOverdue(due){
  const raw=todoDate(due);
  if(!raw)return 0;
  const [y,m,d]=raw.split("-").map(Number);
  const [ty,tm,td]=today().split("-").map(Number);
  const ms=new Date(ty,tm-1,td)-new Date(y,m-1,d);
  return Math.round(ms/86400000);
}
function overdueLabel(due){
  const n=daysOverdue(due);
  return `${n} day${n===1?"":"s"} overdue`;
}
function img(r,cls="thumb"){return r.image?`<img class="${cls}" src="${esc(r.image)}" alt="" loading="lazy">`:`<div class="${cls}" style="display:grid;place-items:center;font-size:26px;color:var(--green)">${icon("soup")}</div>`}
function nav(a){return `<nav class="bottom"><button class="nav ${a==="home"?"active":""}" onclick="show('home')"><span class="ni">${icon("house")}</span>Home</button><button class="nav ${a==="meals"?"active":""}" onclick="show('meals')"><span class="ni">${icon("utensils")}</span>Meals</button><button class="nav ${a==="todo"?"active":""}" onclick="show('todo')"><span class="ni">${icon("list-checks")}</span>Lists</button><button class="nav ${a==="events"?"active":""}" onclick="show('events')"><span class="ni">${icon("calendar-days")}</span>Events</button><button class="nav" onclick="toast('More coming soon')"><span class="ni">${icon("ellipsis")}</span>More</button></nav>`}
function header(title="",back=false,backTo="home"){return `<header class="header">${back?`<button class="back" onclick="show('${backTo}')" aria-label="Back">${icon("chevron-left")}</button>`:`<div class="logo">Daily Life</div>`}<h1 class="screen-title">${back?esc(title):""}</h1><button class="avatar" onclick="show('token')" aria-label="Connection settings" title="Connection settings">${icon("key-round")}</button></header>`}
async function load(kind,{force=false,background=false}={}){
  const meta=cacheMeta[kind];
  if(!force&&meta.loaded){if(!isFresh(kind)&&!meta.promise)meta.promise=load(kind,{force:true,background:true}).finally(()=>meta.promise=null);return state}
  if(meta.promise)return meta.promise;
  const path=kind==="recipes"?"/api/recipes":kind==="todos"?"/api/todos":kind==="todo-options"?"/api/todo-options":kind==="events"?"/api/events?days=14":"/api/meal-plan";
  const request=(async()=>{try{
    const d=await api(path);
    if(kind==="recipes")state.recipes=d.recipes||[];
    if(kind==="todos")state.todos=(d.todos||[]).map(t=>({...t,due:todoDate(t.due),bucket:bucket(t)}));
    if(kind==="todo-options")state.todoOptions={categories:d.categories||[],statuses:d.statuses||[]};
    if(kind==="mealPlan")state.mealPlan=d.mealPlan||[];
    if(kind==="events")state.events=d.events||[];
    markLoaded(kind); return d;
  }catch(e){
    if(kind==="todo-options"){state.todoOptions={categories:[],statuses:[]};markLoaded(kind);return {categories:[],statuses:[],fallback:true}}
    if(kind==="events"&&!(background&&meta.loaded)){state.events=[];markLoaded(kind);return {events:[],fallback:true}}
    if(background&&meta.loaded){console.warn(`Background refresh failed for ${kind}.`,e);return state}
    throw e;
  }})();
  meta.promise=request; try{return await request}finally{if(meta.promise===request)meta.promise=null}
}
async function all({force=false}={}){await Promise.all([load("recipes",{force}),load("todos",{force}),load("mealPlan",{force}),load("events",{force})]);return state}
function refreshDataInBackground(kinds=["recipes","todos","mealPlan","events"]){for(const k of kinds)if(cacheMeta[k].loaded&&!cacheMeta[k].promise)load(k,{force:true,background:true})}
function recipeFor(item){return state.recipes.find(r=>r.id===item?.recipeId)}

// Events are timestamps (or date-only for all-day items), unlike task due
// dates. Bucket them into the viewer's local calendar day for grouping.
function eventDayKey(e){return e.allDay?e.start:iso(new Date(e.start))}
function eventsUpcoming(days){const end=new Date();end.setDate(end.getDate()+days);return state.events.filter(e=>new Date(e.start)<=end)}
function groupEventsByDay(events){
  const map=new Map();
  for(const e of events){const key=eventDayKey(e);if(!map.has(key))map.set(key,[]);map.get(key).push(e)}
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
}
function eventDayLabel(dayKey){
  if(dayKey===today())return"Today";
  if(dayKey===tomorrow())return"Tomorrow";
  const [y,m,d]=dayKey.split("-").map(Number);
  const date=new Date(y,m-1,d);
  return Number.isNaN(date.getTime())?dayKey:date.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
}
function eventTimeLabel(e){return e.allDay?"All day":new Date(e.start).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}
function connectionModal(success,title,message){
  return `<div class="modal-backdrop" id="connection-modal" role="presentation">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-modal-title">
      <div class="modal-icon ${success?"success":"failure"}">${icon(success?"check":"x")}</div>
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
      button.innerHTML=icon("plug-zap")+" Test connection";
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
      <button class="back" onclick="${hasAppToken()?"show('home')":"toast('Enter your token to connect')"}" aria-label="Back">${icon("chevron-left")}</button>
      <h1 class="screen-title">Connection</h1>
      <div style="width:38px"></div>
    </header>

    <main class="page token-page">

      <div class="token-illustration" aria-hidden="true">
        <span class="token-shape mint"></span>
        <span class="token-shape lilac"></span>
        <span class="token-shape yellow"></span>
        <span class="token-key">${icon("key-round","icon-thin")}</span>
      </div>

      <div class="eyebrow">Daily Life</div>

      <h1 class="token-title">Enter your app token</h1>

      <p class="token-intro">
        Your token connects Daily Life to your family data through your Cloudflare Worker.
      </p>

      <label class="token-label" for="app-token">App token</label>

      <div class="token-input-wrap">
        <span aria-hidden="true">${icon("key-round")}</span>
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
        Save &amp; Connect ${icon("arrow-right")}
      </button>

      <button id="test-connection" class="secondary-button" onclick="testConnection()">
        ${icon("plug-zap")} Test connection
      </button>

      <div class="help-divider">
        <span></span>
        <b>Need help?</b>
        <span></span>
      </div>

      <div class="help-card">
        <div class="help-icon" aria-hidden="true">${icon("info")}</div>
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

function todayMealsHtml(){
  const order=["breakfast","lunch","dinner"];
  const rank=m=>{const i=order.indexOf(String(m.meal||"").toLowerCase());return i<0?99:i};
  const rows=state.mealPlan.filter(m=>m.date===today()).sort((a,b)=>rank(a)-rank(b)).map(m=>{
    const r=recipeFor(m),title=r?.name||m.recipeName;
    if(!title)return"";
    return `<div class="card row"${r?` onclick="show('recipe','${esc(r.id)}')"`:""}>${r?img(r):""}<div class="grow"><div class="eyebrow">${esc(m.meal||"Meal")}</div><div class="title">${esc(title)}</div></div>${r?`<div class="chev">${icon("chevron-right")}</div>`:""}</div>`;
  }).join("");
  return rows||`<div class="card" style="padding:18px"><div class="sub">Nothing planned for today.</div></div>`;
}
function home(){const ts=state.todos.filter(t=>t.bucket==="today"&&t.status!=="Done").slice(0,3),ec=eventsUpcoming(7).length,period=dayPeriod();return `<div class="shell">${header()}<main class="page"><div class="eyebrow">${greetingText(period)},</div><div class="hello">The Wilsons <span class="sun">${icon(greetingIcon(period))}</span></div><div class="modules"><button class="module m-meal" onclick="show('meals')"><div class="ico">${icon("utensils")}</div><div class="module-title">Meals</div><div class="module-sub">Recipes and meal plan<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-todo" onclick="show('todo')"><div class="ico">${icon("clipboard-list")}</div><div class="module-title">To do</div><div class="module-sub">${state.todos.filter(t=>t.status!=="Done").length} tasks<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-events" onclick="show('events')"><div class="ico">${icon("calendar-days")}</div><div class="module-title">Events</div><div class="module-sub">${ec} this week<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-family" onclick="toast('Family coming next')"><div class="ico">${icon("users")}</div><div class="module-title">Family</div><div class="module-sub">Coming soon<span class="chev">${icon("chevron-right")}</span></div></button></div><div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>${todayMealsHtml()}${ts.map(t=>`<div class="card row" onclick="show('todo')"><button class="check" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.category||"")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("")}</main>${nav("home")}</div>`}
function cookTime(v){if(v===null||v===undefined||v==="")return"";return typeof v==="number"?`${v} min`:String(v)}
function meals(){
  const n=cacheMeta.recipes.loaded?state.recipes.length:0;
  return `<div class="shell">${header("Meals",true)}<main class="page"><div class="modules"><button class="module m-meal" onclick="show('recipes')"><div class="ico">${icon("book-open")}</div><div class="module-title">Recipes</div><div class="module-sub">${n?`${n} recipe${n===1?"":"s"}`:"Browse and cook"}<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-events" onclick="toast('Meal plan coming next')"><div class="ico">${icon("calendar-days")}</div><div class="module-title">Meal plan</div><div class="module-sub">Coming next<span class="chev">${icon("chevron-right")}</span></div></button></div></main>${nav("meals")}</div>`;
}
function recipes(){return `<div class="shell">${header("Recipes",true,"meals")}<main class="page">${state.recipes.map(r=>`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${[r.cuisine,cookTime(r.cookingTime),r.servings?`${r.servings} servings`:""].filter(Boolean).map(esc).join(" · ")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("")||'<div class="empty">No recipes found.</div>'}</main>${nav("meals")}</div>`}
async function recipe(id){const cached=state.recipes.find(x=>x.id===id);if(cached&&(cached.ingredients||cached.recipeText||cached.notes))return renderRecipe(cached);const d=await api(`/api/recipes/${encodeURIComponent(id)}`),r=d.recipe;if(!r)throw Error("Recipe not found");const i=state.recipes.findIndex(x=>x.id===id);if(i>=0)state.recipes[i]={...state.recipes[i],...r};else state.recipes.push(r);return renderRecipe(state.recipes.find(x=>x.id===id)||r)}
/* Recipe ticks are per device (localStorage), keyed by recipe id. i = ingredients, s = method steps. */
const TICKS_KEY="dailyLifeTicks";
function readTicks(){try{return JSON.parse(localStorage.getItem(TICKS_KEY))||{}}catch{return{}}}
function ticksFor(id){const t=readTicks()[id]||{};return{i:new Set(t.i||[]),s:new Set(t.s||[])}}
function writeTicks(id,t){try{const all=readTicks();if(t.i.size||t.s.size)all[id]={i:[...t.i],s:[...t.s]};else delete all[id];localStorage.setItem(TICKS_KEY,JSON.stringify(all))}catch{}}
function toggleTick(id,kind,idx,el){const t=ticksFor(id),set=t[kind],on=!set.has(idx);if(on)set.add(idx);else set.delete(idx);writeTicks(id,t);el.classList.toggle("ticked",on);el.setAttribute("aria-pressed",String(on))}
function resetTicks(id){writeTicks(id,{i:new Set(),s:new Set()});document.querySelectorAll(".tick-row.ticked").forEach(el=>{el.classList.remove("ticked");el.setAttribute("aria-pressed","false")})}
function methodSteps(text){return String(text||"").split(/\r?\n/).map(l=>l.replace(/^\s*(?:\d+[.)]\s*|[-•*]\s*)/,"").trim()).filter(Boolean)}
function tickRow(id,kind,idx,text,ticked){return `<button class="tick-row${ticked?" ticked":""}" aria-pressed="${ticked}" onclick="toggleTick('${esc(id)}','${kind}',${idx},this)"><span class="tick-circle"></span><span class="tick-text">${esc(text)}</span></button>`}
function renderRecipe(r){
  const ing=Array.isArray(r.ingredients)?r.ingredients:[];
  const steps=methodSteps(r.recipeText);
  const t=ticksFor(r.id);
  const reset=`<button class="link" onclick="resetTicks('${esc(r.id)}')">Reset ticks</button>`;
  const source=/^https?:\/\//i.test(r.sourceUrl||"")?`<a class="link source-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")} View original recipe</a>`:"";
  return `<div class="shell">${header(r.name,true,"recipes")}<main class="page"><article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}" alt="">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px;color:var(--green)">${icon("soup","icon-thin")}</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>${icon("clock")} ${esc(cookTime(r.cookingTime))}</span>`:""}${r.servings?`<span>${icon("users")} ${esc(r.servings)} servings</span>`:""}${r.difficulty?`<span>${icon("chef-hat")} ${esc(r.difficulty)}</span>`:""}</div>${r.notes?`<p class="desc">${esc(r.notes)}</p>`:""}${source}${ing.length?`<div class="section-row"><h3>Ingredients</h3>${reset}</div>${ing.map((x,i)=>tickRow(r.id,"i",i,typeof x==="string"?x:(x.text||x.name||""),t.i.has(i))).join("")}`:""}${steps.length?`<div class="section-row"><h3>Method</h3>${ing.length?"":reset}</div>${steps.map((x,i)=>tickRow(r.id,"s",i,x,t.s.has(i))).join("")}`:""}${!ing.length&&!steps.length?`<p class="desc">No ingredients or method saved for this recipe yet.</p>`:""}<button class="action-btn m-meal" onclick="toast('Meal-plan editing coming next')">${icon("calendar-plus")} Add to meal plan</button></div></article></main></div>`}
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
  else if(todoFilter==="Overdue") ts=ts.filter(t=>bucket(t)==="overdue");
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
  const groups=[ ["overdue","Overdue"],["today","Today"],["tomorrow","Tomorrow"],["upcoming","Upcoming"] ];
  let sections="";
  for(const [b,label] of groups){
    const group=ts.filter(t=>t.bucket===b);
    if(!group.length) continue;
    const isOverdueGroup=b==="overdue";
    sections += `<div class="todo-group${isOverdueGroup?" overdue":""}"><b>${label}</b><span>${group.filter(t=>todoStatusClass(t.status)!=="done").length} remaining</span></div>`;
    for(const t of group){
      const sc=todoStatusClass(t.status);
      const tag=t.category?`<span class="tag ${esc(t.category)}">${esc(t.category)}</span>`:"";
      const due=t.due?`<div class="sub${isOverdueGroup?" overdue-date":""}">${isOverdueGroup?overdueLabel(t.due):esc(dateLabel(t.due))}</div>`:"";
      const stateText=sc==="progress"?`<span class="status-text">In progress</span>`:"";
      sections += `<div class="card row todo-row${isOverdueGroup?" overdue":""}">
        <button aria-label="Change task status" class="check ${sc}" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button>
        <div class="grow" onclick="editTodo('${esc(t.id)}')" style="cursor:pointer">
          <div class="title ${sc==="done"?"completed":""}">${esc(t.task)}</div>${stateText}${tag}${due}
        </div>
        <button class="chev" onclick="editTodo('${esc(t.id)}')" aria-label="Edit task">${icon("chevron-right")}</button></div>`;
    }
  }
  return `<div class="shell">${header("To do",false)}<main class="page"><div style="display:flex;justify-content:space-between;align-items:center"><h1 class="screen-title">To do</h1><button class="plus" onclick="openTodoForm()" aria-label="Add task">${icon("plus")}</button></div><div class="filterbar">${["All","Overdue","Today","Upcoming","Done"].map(x=>`<button class="pill ${todoFilter===x?"active":""}" onclick="todoFilter='${x}';show('todo')">${x}</button>`).join("")}</div><div class="todo-toolbar"><span>Sort by due date</span><button class="sort-button" onclick="todoSort=todoSort==='desc'?'asc':'desc';show('todo')">${todoSort==='desc'?"Newest first "+icon("arrow-down"):"Oldest first "+icon("arrow-up")}</button></div>${sections||'<div class="empty">No tasks found.</div>'}</main>${nav("todo")}</div>`;
}
function editTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;openTodoForm(t);load("todo-options")}
async function toggleTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;const previous=t.status,status=nextTodoStatus(previous);t.status=status;t.bucket=bucket(t);show("todo");try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status})});markLoaded("todos")}catch(e){t.status=previous;t.bucket=bucket(t);show("todo");toast("Couldn't update task: "+e.message)}}
async function deleteTodo(id){if(!confirm("Delete this task?"))return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"DELETE"});state.todos=state.todos.filter(x=>x.id!==id);markLoaded("todos");closeTodoForm();toast("Task deleted");show("todo")}catch(e){toast("Couldn't delete task: "+e.message)}}
function events(){
  const groups=groupEventsByDay(state.events);
  const body=groups.length?groups.map(([dayKey,list])=>`<div class="todo-group"><b>${eventDayLabel(dayKey)}</b></div>${list.map(e=>`<div class="card row"><div class="event-time">${eventTimeLabel(e)}</div><div class="grow"><div class="title">${esc(e.title)}</div>${e.location?`<div class="sub">${esc(e.location)}</div>`:""}</div></div>`).join("")}`).join(""):'<div class="empty">No events in the next 14 days.</div>';
  return `<div class="shell">${header("Events",false)}<main class="page"><div style="display:flex;justify-content:space-between;align-items:center"><h1 class="screen-title">Events</h1><a class="plus" href="https://calendar.google.com/calendar/u/0/r/eventedit" target="_blank" rel="noopener" aria-label="Add event">${icon("plus")}</a></div>${body}</main>${nav("events")}</div>`;
}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
function errorScreen(e){return `<div class="shell">${header()}<main class="page"><div class="card" style="padding:20px"><div class="eyebrow">Connection problem</div><h2>Daily Life couldn't reach the Worker.</h2><p class="sub">${esc(e?.message||"Unknown error")}</p><p class="sub">Check DAILY_LIFE_API and DAILY_LIFE_APP_TOKEN in app.js.</p><button class="action-btn m-meal" onclick="show('home')">Try again</button></div></main>${nav("home")}</div>`}
async function show(page,id){
  scrollTo(0,0);const app=document.getElementById("app");
  try{
    if(page==="token"){app.innerHTML=tokenScreen();return}
    if(!hasAppToken()){app.innerHTML=tokenScreen();return}
    if(page==="home"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await all()}
    else if(page==="recipes"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("recipes")}
    else if(page==="todo"&&!cacheMeta.todos.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("todos")}
    else if(page==="events"&&!cacheMeta.events.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("events")}
    let h;if(page==="home")h=home();else if(page==="recipes")h=recipes();else if(page==="recipe")h=await recipe(id);else if(page==="events")h=events();else if(page==="meals")h=meals();else h=todo();
    app.innerHTML=h;
    if(page==="home")refreshDataInBackground(["recipes","todos","mealPlan","events"]);
    if(page==="meals"||page==="recipes"||page==="recipe")refreshDataInBackground(["recipes"]);
    if(page==="todo"){refreshDataInBackground(["todos"]);if(!cacheMeta["todo-options"].loaded)load("todo-options",{background:true})}
    if(page==="events")refreshDataInBackground(["events"]);
  }catch(e){console.error(e);app.innerHTML=errorScreen(e)}
}
if(!window.location.hash)show("home");
