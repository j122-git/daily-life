/* Daily Life frontend — Cloudflare Worker + Airtable */
const API=(window.DAILY_LIFE_API||"https://daily-life.thibaud-guerrero.workers.dev/").replace(/\/$/,"");
let APP_TOKEN=localStorage.getItem("dailyLifeAppToken")||"";
let state={recipes:[],todos:[],mealPlan:[],events:[],budget:null,budgetError:null,todoOptions:{categories:[],statuses:[]}};
const CACHE_TTL=60*1000;
const cacheMeta={recipes:{loaded:false,at:0,promise:null},todos:{loaded:false,at:0,promise:null},mealPlan:{loaded:false,at:0,promise:null},events:{loaded:false,at:0,promise:null},"todo-options":{loaded:false,at:0,promise:null},budget:{loaded:false,at:0,promise:null}};
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
function nav(a){const tabs=[["home","house","Home"],["meals","utensils","Meals"],["planner","clipboard-list","Planner"],["budget","wallet","Budget"],["settings","ellipsis","More"]];return `<nav class="bottom" aria-label="Main"><div class="rail-logo">Daily<br>Life ${icon("sun")}</div>${tabs.map(([p,i,l])=>`<button class="nav ${a===p?"active":""}${p==="settings"?" nav-more":""}"${a===p?' aria-current="page"':""} onclick="show('${p}')"><span class="ni">${icon(i)}</span>${l}</button>`).join("")}<button class="nav rail-docs" onclick="openDocuments()"><span class="ni">${icon("folder")}</span>Documents<span class="rail-ext">${icon("external-link")}</span></button></nav>`}
function header(cog=false){return `<header class="header"><div class="logo">Daily Life</div>${cog?`<button class="avatar" onclick="show('settings')" aria-label="Settings" title="Settings">${icon("settings")}</button>`:""}</header>`}
async function load(kind,{force=false,background=false}={}){
  const meta=cacheMeta[kind];
  if(!force&&meta.loaded){if(!isFresh(kind)&&!meta.promise)meta.promise=load(kind,{force:true,background:true}).finally(()=>meta.promise=null);return state}
  if(meta.promise)return meta.promise;
  const path=kind==="recipes"?"/api/recipes":kind==="todos"?"/api/todos":kind==="todo-options"?"/api/todo-options":kind==="events"?"/api/events?days=14":kind==="budget"?"/api/budget":"/api/meal-plan";
  const request=(async()=>{try{
    const d=await api(path);
    if(kind==="recipes")state.recipes=d.recipes||[];
    if(kind==="todos")state.todos=(d.todos||[]).map(t=>({...t,due:todoDate(t.due),bucket:bucket(t)}));
    if(kind==="todo-options")state.todoOptions={categories:d.categories||[],statuses:d.statuses||[]};
    if(kind==="mealPlan")state.mealPlan=d.mealPlan||[];
    if(kind==="events")state.events=d.events||[];
    if(kind==="budget"){state.budget=d;state.budgetError=null}
    markLoaded(kind); return d;
  }catch(e){
    if(kind==="todo-options"){state.todoOptions={categories:[],statuses:[]};markLoaded(kind);return {categories:[],statuses:[],fallback:true}}
    if(kind==="budget"){if(background&&state.budget){console.warn("Background refresh failed for budget.",e);return state}state.budget=null;state.budgetError=e?.message||"Request failed";markLoaded(kind);return {fallback:true}}
    if(kind==="events"&&!(background&&meta.loaded)){state.events=[];markLoaded(kind);return {events:[],fallback:true}}
    if(background&&meta.loaded){console.warn(`Background refresh failed for ${kind}.`,e);return state}
    throw e;
  }})();
  meta.promise=request; try{return await request}finally{if(meta.promise===request)meta.promise=null}
}
async function all({force=false}={}){await Promise.all([load("recipes",{force}),load("todos",{force}),load("mealPlan",{force}),load("events",{force}),load("budget",{force})]);return state}
function refreshDataInBackground(kinds=["recipes","todos","mealPlan","events","budget"]){for(const k of kinds)if(cacheMeta[k].loaded&&!cacheMeta[k].promise)load(k,{force:true,background:true})}
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

function connectionFailed(e){
  removeAppToken();
  const unauthorised=/unauthorised|unauthorized|401/i.test(e?.message||"");
  return connectionModal(
    false,
    unauthorised?"Token not recognised":"Could not connect",
    unauthorised
      ?"The app token was rejected. Check the token and try again."
      :"We couldn't reach the Daily Life server. Check your Worker URL and connection, then try again."
  );
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
    document.body.insertAdjacentHTML("beforeend",connectionFailed(e));
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
    document.body.insertAdjacentHTML("beforeend",connectionFailed(e));
  }
}

function tokenScreen(){
  return `<div class="shell">
    <header class="header"><div class="logo">Daily Life</div></header>

    <main class="page token-page">
      ${hasAppToken()?crumbs([{label:"Settings",page:"settings"},{label:"Authentication"}]):""}
      <h1 class="screen-title page-title">Authentication</h1>

      <div class="token-illustration" aria-hidden="true">
        <span class="token-shape mint"></span>
        <span class="token-shape lilac"></span>
        <span class="token-shape yellow"></span>
        <span class="token-key">${icon("key-round","icon-thin")}</span>
      </div>

      <div class="eyebrow">Daily Life</div>

      <h2 class="token-title">Enter your app token</h2>

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

/* ---- Meal plan (v0.3.1) ---- */
let currentPage="home";
let planWeek=null;
const MEALS=["Breakfast","Lunch","Dinner"];
function byId(id){return document.getElementById(id)}
function weekStartOf(d=new Date()){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const wd=x.getDay();x.setDate(x.getDate()+(wd===0?-6:1-wd));return iso(x)}
function isoDate(str){const [y,m,d]=str.split("-").map(Number);return new Date(y,m-1,d)}
function shiftIso(str,days){const [y,m,d]=str.split("-").map(Number);return iso(new Date(y,m-1,d+days))}
// Airtable's Meal options may be spelled "Diner"; map loosely onto the three slots.
function slotOf(m){const v=String(m?.meal||"").toLowerCase();return v.startsWith("break")?"Breakfast":v.startsWith("lunch")?"Lunch":v.startsWith("din")?"Dinner":null}
function planCountText(){
  if(!cacheMeta.mealPlan.loaded)return"Plan your week";
  const start=weekStartOf(),end=shiftIso(start,6);
  const n=state.mealPlan.filter(m=>m.date>=start&&m.date<=end).length;
  return n?`${n} planned this week`:"Nothing planned yet";
}
function planItem(m){
  const r=recipeFor(m),name=r?.name||"Recipe",id=esc(m.id);
  return `<div class="plan-item${m.cooked?" cooked":""}"><button class="plan-tick${m.cooked?" ticked":""}" aria-label="Mark as cooked" aria-pressed="${!!m.cooked}" onclick="toggleCooked('${id}',this)"><span class="tick-circle"></span></button><div class="plan-main"${r?` role="button" tabindex="0" onclick="show('recipe','${esc(r.id)}')"`:""}><div class="plan-title">${esc(name)}</div>${m.servings?`<div class="sub">${esc(m.servings)} servings</div>`:""}</div><button class="plan-more" aria-label="Edit meal" onclick="openPlanForm({id:'${id}'})">${icon("ellipsis")}</button></div>`;
}
function plan(){
  if(!planWeek)planWeek=weekStartOf();
  const days=[...Array(7)].map((_,i)=>shiftIso(planWeek,i));
  const fmt=d=>isoDate(d).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
  const current=planWeek===weekStartOf();
  const body=days.map(day=>{
    const label=isoDate(day).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
    const slots=MEALS.map(slot=>{
      const items=state.mealPlan.filter(m=>m.date===day&&slotOf(m)===slot);
      return `<div class="slot"><b class="slot-name">${slot}</b><div class="slot-items">${items.map(planItem).join("")}<button class="slot-add" onclick="openPlanForm({date:'${day}',meal:'${slot}'})" aria-label="Add ${slot}">${icon("plus")}${items.length?"":" Add a meal"}</button></div></div>`;
    }).join("");
    return `<div class="plan-day${day===today()?" today":""}"><h3>${label}</h3>${slots}</div>`;
  }).join("");
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Meals",page:"meals"},{label:"Meal plan"}])}<h1 class="screen-title page-title">Meal plan</h1><div class="week-nav"><button class="back" onclick="planShift(-7)" aria-label="Previous week">${icon("chevron-left")}</button><div class="week-label">${fmt(days[0])} – ${fmt(days[6])}${current?"":`<button class="link" onclick="planToday()">This week</button>`}</div><button class="back" onclick="planShift(7)" aria-label="Next week">${icon("chevron-right")}</button></div>${body}</main>${nav("meals")}</div>`;
}
// Re-render the plan screen in place, keeping the scroll position.
function rerenderPlan(){
  if(currentPage==="planner"){rerenderCal();return}
  if(currentPage!=="plan")return;
  const y=window.scrollY||0;byId("app").innerHTML=plan();scrollTo(0,y);
}
function planShift(days){planWeek=shiftIso(planWeek||weekStartOf(),days);rerenderPlan()}
function planToday(){planWeek=weekStartOf();rerenderPlan()}
function planFormHtml(o){
  const e=o.id?state.mealPlan.find(x=>x.id===o.id):null;
  const recipesSorted=[...state.recipes].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
  const recipeId=e?.recipeId||o.recipeId||recipesSorted[0]?.id||"";
  const rec=state.recipes.find(r=>r.id===recipeId);
  const date=e?.date||o.date||today();
  const meal=e?(slotOf(e)||"Dinner"):(o.meal||"Dinner");
  const servings=e?(e.servings??rec?.servings??""):(rec?.servings??"");
  const id=esc(e?.id||"");
  return `<div class="modal-backdrop sheet-bg" id="plan-form-modal">
    <div class="modal sheet todo-form" role="dialog" aria-modal="true" aria-labelledby="plan-form-title">
      <div class="eyebrow">${e?"Edit meal":"Add to meal plan"}</div>
      <h2 id="plan-form-title">${e?"Edit planned meal":"When will you cook it?"}</h2>
      <label class="form-label" for="plan-recipe">Recipe</label>
      <select class="form-input" id="plan-recipe" onchange="planRecipeChanged()">${recipesSorted.map(r=>`<option value="${esc(r.id)}" ${r.id===recipeId?"selected":""}>${esc(r.name)}</option>`).join("")}</select>
      <label class="form-label" for="plan-date">Day</label>
      <input class="form-input" id="plan-date" type="date" value="${esc(date)}">
      <label class="form-label" for="plan-meal">Meal</label>
      <select class="form-input" id="plan-meal">${MEALS.map(x=>`<option value="${x}" ${x===meal?"selected":""}>${x}</option>`).join("")}</select>
      <label class="form-label" for="plan-servings">Servings</label>
      <input class="form-input" id="plan-servings" type="number" min="0.5" step="0.5" inputmode="decimal" value="${esc(servings)}">
      <div class="form-actions"><button class="secondary-button" onclick="closePlanForm()">Cancel</button><button class="primary-button" onclick="savePlan('${id}')">${e?"Save changes":"Add to plan"}</button></div>
      ${e?`<button class="danger-button" onclick="removeMeal('${id}')">Remove from plan</button>`:""}
    </div>
  </div>`;
}
function openPlanForm(o={}){
  if(!state.recipes.length){toast("No recipes to plan yet");return}
  closePlanForm();
  document.body.insertAdjacentHTML("beforeend",planFormHtml(o));
}
function closePlanForm(){byId("plan-form-modal")?.remove()}
function planRecipeChanged(){
  const rec=state.recipes.find(r=>r.id===byId("plan-recipe")?.value);
  const input=byId("plan-servings");
  if(input&&rec&&rec.servings!==null&&rec.servings!==undefined)input.value=rec.servings;
}
function planWhen(date,meal){return `${isoDate(date).toLocaleDateString("en-GB",{weekday:"long"})} ${String(meal).toLowerCase()}`}
async function savePlan(id){
  const recipeId=byId("plan-recipe")?.value||"";
  const date=byId("plan-date")?.value||"";
  const meal=byId("plan-meal")?.value||"Dinner";
  const raw=byId("plan-servings")?.value??"";
  if(!recipeId){toast("Choose a recipe");return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast("Choose a day");return}
  const servings=raw===""?null:Number(raw);
  if(servings!==null&&!(servings>0)){toast("Servings must be above 0");return}
  const body={recipeId,date,meal,servings};
  if(id){
    const i=state.mealPlan.findIndex(x=>x.id===id);
    if(i<0){closePlanForm();return}
    const previous=state.mealPlan[i];
    state.mealPlan[i]={...previous,recipeId,date,meal,servings};
    closePlanForm();rerenderPlan();toast("Meal updated");
    try{await api(`/api/meal-plan/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(body)});markLoaded("mealPlan")}
    catch(e){const j=state.mealPlan.findIndex(x=>x.id===id);if(j>=0)state.mealPlan[j]=previous;rerenderPlan();toast("Couldn't save meal: "+e.message)}
  }else{
    try{
      const d=await api("/api/meal-plan",{method:"POST",body:JSON.stringify(body)});
      if(d?.entry){state.mealPlan.push(d.entry);markLoaded("mealPlan")}else invalidate("mealPlan");
      closePlanForm();rerenderPlan();toast(`Added to ${planWhen(date,meal)}`);
    }catch(e){toast("Couldn't save meal: "+e.message)}
  }
}
async function removeMeal(id){
  if(!confirm("Remove this meal from the plan?"))return;
  try{
    await api(`/api/meal-plan/${encodeURIComponent(id)}`,{method:"DELETE"});
    state.mealPlan=state.mealPlan.filter(x=>x.id!==id);markLoaded("mealPlan");
    closePlanForm();rerenderPlan();toast("Meal removed");
  }catch(e){toast("Couldn't remove meal: "+e.message)}
}
async function toggleCooked(id,el){
  const m=state.mealPlan.find(x=>x.id===id);if(!m)return;
  const apply=on=>{m.cooked=on;el?.classList.toggle("ticked",on);el?.setAttribute("aria-pressed",String(on));el?.closest(".plan-item")?.classList.toggle("cooked",on)};
  const previous=!!m.cooked;apply(!previous);
  try{await api(`/api/meal-plan/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({cooked:!previous})});markLoaded("mealPlan")}
  catch(e){apply(previous);toast("Couldn't update meal: "+e.message)}
}
function todayMealsHtml(){
  const order=["breakfast","lunch","dinner"];
  const rank=m=>{const i=order.indexOf(String(slotOf(m)||"").toLowerCase());return i<0?99:i};
  const rows=state.mealPlan.filter(m=>m.date===today()).sort((a,b)=>rank(a)-rank(b)).map(m=>{
    const r=recipeFor(m);
    if(!r?.name)return"";
    return `<div class="card row" role="button" tabindex="0" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="eyebrow">${esc(slotOf(m)||m.meal||"Meal")}</div><div class="title">${esc(r.name)}</div></div><div class="chev">${icon("chevron-right")}</div></div>`;
  }).join("");
  return rows||`<div class="card" style="padding:18px"><div class="sub">Nothing planned for today.</div></div>`;
}
function home(){if(isTablet())return dashboard();const ts=state.todos.filter(t=>t.bucket==="today"&&isOpen(t)).slice(0,3),ec=eventsUpcoming(7).length,openTasks=state.todos.filter(isOpen).length,period=dayPeriod();return `<div class="shell">${header(true)}<main class="page"><div class="eyebrow">${greetingText(period)},</div><div class="hello">The Wilsons <span class="sun">${icon(greetingIcon(period))}</span></div><div class="modules"><button class="module m-meal" onclick="show('meals')"><div class="ico">${icon("utensils")}</div><div class="module-title">Meals</div><div class="module-sub">Recipes and meal plan<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-todo" onclick="show('planner')"><div class="ico">${icon("clipboard-list")}</div><div class="module-title">Planner</div><div class="module-sub">${openTasks} task${openTasks===1?"":"s"} · ${ec} event${ec===1?"":"s"}<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-family" onclick="openDocuments()"><div class="ico">${icon("folder")}</div><div class="module-title">Documents</div><div class="module-sub">Open in Drive<span class="chev">${icon("external-link")}</span></div></button><button class="module m-budget" onclick="show('budget')">${budgetBadge()}<div class="ico">${icon("wallet")}</div><div class="module-title">Budget</div><div class="module-sub">${esc(budgetTileSub())}<span class="chev">${icon("chevron-right")}</span></div></button></div>${budgetAttentionHtml()}<div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>${todayMealsHtml()}${ts.map(t=>`<div class="card row" onclick="show('todo')"><button class="check" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.category||"")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("")}</main>${nav("home")}</div>`}
function cookTime(v){if(v===null||v===undefined||v==="")return"";return typeof v==="number"?`${v} min`:String(v)}
function meals(){
  const n=cacheMeta.recipes.loaded?state.recipes.length:0;
  return `<div class="shell">${header()}<main class="page"><h1 class="screen-title page-title">Meals</h1><div class="modules"><button class="module m-meal" onclick="show('recipes')"><div class="ico">${icon("book-open")}</div><div class="module-title">Recipes</div><div class="module-sub">${n?`${n} recipe${n===1?"":"s"}`:"Browse and cook"}<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-events" onclick="show('plan')"><div class="ico">${icon("calendar-days")}</div><div class="module-title">Meal plan</div><div class="module-sub">${esc(planCountText())}<span class="chev">${icon("chevron-right")}</span></div></button></div></main>${nav("meals")}</div>`;
}
/* ---- Planner hub and Documents link (v0.3.6) ---- */
let familyLinks=null,linksPromise=null;
function loadLinks(){
  if(familyLinks&&!familyLinks.error)return Promise.resolve();
  if(linksPromise)return linksPromise;
  linksPromise=api("/api/links").then(d=>{familyLinks=d||{}}).catch(e=>{familyLinks={error:e?.message||"error"}}).finally(()=>{linksPromise=null});
  return linksPromise;
}
function openDocuments(){
  const url=familyLinks?.driveUrl;
  if(url){window.open(url,"_blank","noopener,noreferrer");return}
  if(familyLinks&&!familyLinks.error){toast("Documents link isn't set up yet. Add FAMILY_DRIVE_URL in Cloudflare.");return}
  if(familyLinks?.error){toast("Couldn't load the link. Update the Worker to v0.3.6.");familyLinks=null;return}
  toast("Loading the link, tap again in a moment");loadLinks();
}
/* ---- Settings (v0.3.4) ---- */
let apiUsage=null,releaseNotes=null;
function settings(){
  const usageSub=apiUsage?.available?`${apiUsage.used.toLocaleString("en-GB")} / ${apiUsage.limit.toLocaleString("en-GB")} calls`:"Monthly Airtable calls";
  const notesSub=releaseNotes?.[0]?.version||"What's new";
  const tile=(cls,page,ico,title,sub)=>`<button class="module ${cls}" onclick="show('${page}')"><div class="ico">${icon(ico)}</div><div class="module-title">${title}</div><div class="module-sub">${esc(sub)}<span class="chev">${icon("chevron-right")}</span></div></button>`;
  return `<div class="shell">${header()}<main class="page"><h1 class="screen-title page-title">Settings</h1><div class="modules">${tile("m-meal","token","key-round","Authentication",hasAppToken()?"Token saved":"Not connected")}${tile("m-events","usage","gauge","API usage",usageSub)}${tile("m-todo","release-notes","file-text","Release notes",notesSub)}</div></main>${nav("settings")}</div>`;
}
function usageScreen(){
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Settings",page:"settings"},{label:"API usage"}])}<h1 class="screen-title page-title">API usage</h1><div id="usage-body"><div class="card usage-card"><div class="sub">Loading…</div></div></div></main>${nav("settings")}</div>`;
}
function usageBody(d){
  if(!d?.available){
    return `<div class="card usage-card"><div class="title">Usage counter not set up</div><p class="sub">To count Airtable calls, add these in Cloudflare:</p><ol class="setup-steps"><li>Create a KV namespace and bind it to the Worker as <code>USAGE</code>.</li><li>Add a variable <code>AIRTABLE_USAGE_SEED</code> with this month's figure from Airtable's Usage tab (optional, applied once).</li></ol></div>`;
  }
  const pct=Math.min(100,d.percent),tone=pct>=90?"high":pct>=70?"mid":"low";
  const month=isoDate(`${d.month}-01`).toLocaleDateString("en-GB",{month:"long",year:"numeric"});
  const resets=isoDate(d.resetsOn).toLocaleDateString("en-GB",{day:"numeric",month:"long"});
  return `<div class="card usage-card"><div class="eyebrow">${esc(month)}</div><div class="usage-figure"><b>${d.used.toLocaleString("en-GB")}</b><span>/ ${d.limit.toLocaleString("en-GB")} calls</span></div><div class="usage-bar ${tone}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div><div class="sub">${d.percent}% used · resets ${esc(resets)}</div></div><p class="token-footnote">An estimate counted by your Worker. Cached responses cost nothing and are not counted. Airtable's own Usage tab is the source of truth.</p>`;
}
async function loadUsage(){
  try{
    const d=await api("/api/usage");apiUsage=d;
    const body=byId("usage-body");if(body)body.innerHTML=usageBody(d);
  }catch(e){
    const body=byId("usage-body");
    const old=/not found|404/i.test(e?.message||"");
    if(body)body.innerHTML=`<div class="card usage-card"><div class="title">Couldn't load usage</div><p class="sub">${old?"Update your Worker to v0.3.4 or later to see usage.":esc(e?.message||"Unknown error")}</p></div>`;
  }
}
function mdInline(t){return esc(t).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>")}
function mdBlock(lines){
  let html="",list=[];
  const flush=()=>{if(list.length){html+=`<ul>${list.map(x=>`<li>${mdInline(x)}</li>`).join("")}</ul>`;list=[]}};
  for(const raw of lines){
    const line=raw.trimEnd();
    if(!line.trim()||/^-{3,}$/.test(line.trim())){flush();continue}
    if(/^##\s+/.test(line)){flush();html+=`<h3>${mdInline(line.replace(/^##\s+/,""))}</h3>`}
    else if(/^\s*-\s+/.test(line))list.push(line.replace(/^\s*-\s+/,""));
    else{flush();html+=`<p>${mdInline(line.trim())}</p>`}
  }
  flush();return html;
}
function parseReleaseNotes(text){
  const parts=String(text||"").replace(/\r/g,"").split(/^# Daily Life (v[\d.]+)[ \t]*$/m);
  const out=[];
  for(let i=1;i<parts.length;i+=2){
    const lines=parts[i+1].split("\n");
    let date="";
    const k=lines.findIndex(l=>l.trim());
    if(k>=0&&/^_.+_$/.test(lines[k].trim())){date=lines[k].trim().slice(1,-1);lines.splice(k,1)}
    out.push({version:parts[i],date,html:mdBlock(lines)});
  }
  return out;
}
function releaseNotesBody(list){
  if(!list.length)return`<div class="empty">No release notes found.</div>`;
  return list.map((v,i)=>i===0
    ?`<section class="notes-version"><h2>${esc(v.version)}${v.date?` <span class="notes-date">${esc(v.date)}</span>`:""}</h2>${v.html}</section>`
    :`<details class="notes-version"><summary>${esc(v.version)}${v.date?` · ${esc(v.date)}`:""}</summary>${v.html}</details>`).join("");
}
function releaseNotesScreen(){
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Settings",page:"settings"},{label:"Release notes"}])}<h1 class="screen-title page-title">Release notes</h1><div id="notes-body">${releaseNotes?releaseNotesBody(releaseNotes):'<div class="empty">Loading…</div>'}</div></main>${nav("settings")}</div>`;
}
async function loadReleaseNotes(){
  try{
    const r=await fetch("RELEASE_NOTES.md",{cache:"no-cache"});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    releaseNotes=parseReleaseNotes(await r.text());
    const body=byId("notes-body");if(body)body.innerHTML=releaseNotesBody(releaseNotes);
  }catch(e){
    const body=byId("notes-body");
    if(body&&!releaseNotes)body.innerHTML=`<div class="empty">Couldn't load release notes. Make sure RELEASE_NOTES.md is published with the app.</div>`;
  }
}
/* ---- Recipe import from a link (v0.3.5) ---- */
let importDraft=null;
function normUrl(u){
  try{
    const x=new URL(u);x.hash="";
    for(const k of [...x.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(k))x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./,"")+x.pathname.replace(/\/+$/,"")+x.search).toLowerCase();
  }catch{return String(u||"").trim().toLowerCase()}
}
function openImport(){closeImport();document.body.insertAdjacentHTML("beforeend",`<div class="modal-backdrop sheet-bg" id="import-modal"><div class="modal sheet todo-form" id="import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title">${importUrlStage()}</div></div>`);setTimeout(()=>byId("import-url")?.focus(),0)}
function closeImport(){byId("import-modal")?.remove();importDraft=null}
function setImportSheet(html){const el=byId("import-sheet");if(el)el.innerHTML=html}
function importUrlStage(message="",dup=null,url=""){
  return `<div class="eyebrow">Add recipe</div><h2 id="import-title">Paste a recipe link</h2>
  <label class="form-label" for="import-url">Link</label>
  <input class="form-input" id="import-url" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://…" value="${esc(url)}" onkeydown="if(event.key==='Enter')importFetch()">
  ${message?`<p class="form-error" role="alert">${esc(message)}</p>`:""}
  ${dup?`<div class="form-warning">Already in your recipes: <b>${esc(dup.name)}</b><div class="form-actions"><button class="secondary-button" onclick="closeImport();show('recipe','${esc(dup.id)}')">Open it</button><button class="primary-button" onclick="importFetch(true)">Import anyway</button></div></div>`:""}
  <div class="form-actions"><button class="secondary-button" onclick="closeImport()">Cancel</button><button class="primary-button" id="import-fetch" onclick="importFetch()">Fetch recipe</button></div>`;
}
async function importFetch(force=false){
  const url=(byId("import-url")?.value||"").trim();
  if(!url){setImportSheet(importUrlStage("Paste a link first"));return}
  if(!force){
    const key=normUrl(url),dup=state.recipes.find(r=>r.sourceUrl&&normUrl(r.sourceUrl)===key);
    if(dup){setImportSheet(importUrlStage("",dup,url));return}
  }
  const button=byId("import-fetch");
  if(button){button.disabled=true;button.textContent="Fetching…"}
  try{
    const d=await api("/api/import/preview",{method:"POST",body:JSON.stringify({url})});
    importDraft=makeImportDraft(d.recipe);
    setImportSheet(importPreviewStage());
  }catch(e){setImportSheet(importUrlStage(e.message||"Couldn't read that link",null,url))}
}
function makeImportDraft(r){
  return {
    title:r.title||"",sourceUrl:r.sourceUrl||"",image:r.image||"",
    servings:r.servings??"",cookingTime:r.cookingTime??"",
    cuisine:importCuisineMatch(r.cuisine),
    steps:(r.steps||[]).join("\n"),
    ingredients:(r.ingredients||[]).map(i=>({quantity:i.quantity===null||i.quantity===undefined?"":String(Math.round(i.quantity*100)/100),unit:i.unit||"",name:i.name||"",preparation:i.preparation||"",optional:!!i.optional,isNew:!!i.isNew}))
  };
}
function importCuisines(){return [...new Set(state.recipes.map(r=>r.cuisine).filter(c=>typeof c==="string"&&c.trim()))].sort((a,b)=>a.localeCompare(b))}
function importCuisineMatch(c){if(!c)return"";return importCuisines().find(x=>x.toLowerCase()===String(c).toLowerCase())||""}
function importIngredientsHtml(){
  const rows=importDraft.ingredients.map((x,i)=>`<div class="imp-ing"><div class="imp-row"><input class="form-input imp-qty" inputmode="decimal" placeholder="Qty" aria-label="Quantity" value="${esc(x.quantity)}" oninput="importIng(${i},'quantity',this.value)"><input class="form-input imp-unit" placeholder="Unit" aria-label="Unit" value="${esc(x.unit)}" oninput="importIng(${i},'unit',this.value)"><input class="form-input imp-name" placeholder="Ingredient" aria-label="Ingredient" value="${esc(x.name)}" oninput="importIng(${i},'name',this.value)"><button class="imp-del" aria-label="Remove ingredient" onclick="importRemoveIng(${i})">${icon("x")}</button></div><div class="imp-meta"><input class="form-input imp-prep" placeholder="Preparation (optional)" aria-label="Preparation" value="${esc(x.preparation)}" oninput="importIng(${i},'preparation',this.value)">${x.isNew?'<span class="badge-new">New</span>':""}</div></div>`).join("");
  return rows||'<div class="sub" style="padding:8px 0">No ingredients. Add at least one.</div>';
}
function importPreviewStage(){
  const d=importDraft,host=(()=>{try{return new URL(d.sourceUrl).hostname.replace(/^www\./,"")}catch{return""}})();
  const cuisines=importCuisines();
  return `<div class="eyebrow">Preview</div><h2 id="import-title">Check the recipe</h2>
  <div class="sub import-source">${esc(host)}</div>
  ${d.image?`<img class="import-img" src="${esc(d.image)}" alt="" loading="lazy">`:""}
  <label class="form-label" for="imp-title">Title</label>
  <input class="form-input" id="imp-title" maxlength="200" value="${esc(d.title)}" oninput="importSet('title',this.value)">
  <div class="two-col"><div><label class="form-label" for="imp-servings">Servings</label><input class="form-input" id="imp-servings" type="number" min="1" step="1" inputmode="decimal" value="${esc(d.servings)}" oninput="importSet('servings',this.value)"></div><div><label class="form-label" for="imp-time">Time (mins)</label><input class="form-input" id="imp-time" type="number" min="1" step="1" inputmode="numeric" value="${esc(d.cookingTime)}" oninput="importSet('cookingTime',this.value)"></div></div>
  <label class="form-label" for="imp-cuisine">Cuisine</label>
  <select class="form-input" id="imp-cuisine" onchange="importSet('cuisine',this.value)"><option value="">None</option>${cuisines.map(c=>`<option value="${esc(c)}" ${c===d.cuisine?"selected":""}>${esc(c)}</option>`).join("")}</select>
  <div class="section-row"><h3>Ingredients</h3><button class="link" onclick="importAddIng()">+ Add ingredient</button></div>
  <div id="imp-ings">${importIngredientsHtml()}</div>
  <label class="form-label" for="imp-steps">Method (one step per line)</label>
  <textarea class="form-input" id="imp-steps" rows="8" oninput="importSet('steps',this.value)">${esc(d.steps)}</textarea>
  <p class="form-error" id="import-error" role="alert" hidden></p>
  <div class="form-actions"><button class="secondary-button" onclick="importBack()">Change link</button><button class="primary-button" id="import-save" onclick="importSave()">Save recipe</button></div>`;
}
function importSet(key,value){if(importDraft)importDraft[key]=value}
function importIng(i,key,value){if(importDraft?.ingredients[i])importDraft.ingredients[i][key]=value}
function importRefreshIngs(){const el=byId("imp-ings");if(el)el.innerHTML=importIngredientsHtml()}
function importAddIng(){importDraft.ingredients.push({quantity:"",unit:"",name:"",preparation:"",optional:false,isNew:false});importRefreshIngs()}
function importRemoveIng(i){importDraft.ingredients.splice(i,1);importRefreshIngs()}
function importBack(){const url=importDraft?.sourceUrl||"";importDraft=null;setImportSheet(importUrlStage("",null,url))}
function importShowError(message){const el=byId("import-error");if(el){el.textContent=message;el.hidden=false;el.scrollIntoView?.({block:"nearest"})}}
function importQuantity(text){
  const t=String(text??"").trim().replace(",",".");
  if(!t)return null;
  let m=t.match(/^(\d+)\s+(\d+)\/(\d+)$/);if(m)return Number(m[1])+Number(m[2])/Number(m[3]);
  m=t.match(/^(\d+)\/(\d+)$/);if(m)return Number(m[1])/Number(m[2]);
  const n=Number(t);return Number.isFinite(n)&&n>=0?n:undefined;
}
async function importSave(){
  const d=importDraft;if(!d)return;
  if(!d.title.trim()){importShowError("Add a title");return}
  const ingredients=[];
  for(const [n,x] of d.ingredients.entries()){
    if(!String(x.name).trim())continue;
    const q=importQuantity(x.quantity);
    if(q===undefined){importShowError(`Check the quantity on "${x.name}"`);return}
    ingredients.push({quantity:q,unit:String(x.unit||"").trim(),name:String(x.name).trim(),preparation:String(x.preparation||"").trim(),optional:!!x.optional});
  }
  if(!ingredients.length){importShowError("Add at least one ingredient");return}
  const num=v=>String(v).trim()===""?null:Number(v);
  const servings=num(d.servings),cookingTime=num(d.cookingTime);
  if(servings!==null&&!(servings>0)){importShowError("Servings must be above 0");return}
  if(cookingTime!==null&&!(cookingTime>0)){importShowError("Time must be above 0");return}
  const recipe={title:d.title.trim(),sourceUrl:d.sourceUrl,image:d.image||null,servings,cookingTime,cuisine:d.cuisine||null,steps:d.steps.split(/\n+/).map(x=>x.trim()).filter(Boolean),ingredients};
  const button=byId("import-save");
  if(button){button.disabled=true;button.textContent="Saving…"}
  try{
    const r=await api("/api/import/save",{method:"POST",body:JSON.stringify({recipe})});
    closeImport();
    toast(r.warning?`Recipe saved. ${r.warning}`:"Recipe saved");
    invalidate("recipes");
    try{await load("recipes",{force:true})}catch(e){}
    show("recipe",r.recipeId);
  }catch(e){
    if(button){button.disabled=false;button.textContent="Save recipe"}
    importShowError(e.message||"Couldn't save the recipe");
  }
}
/* ---- Recipes list: search + filter pills (v0.3.3) ---- */
let recipeQuery="",recipeFilter="All";
function crumbs(items){
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map(c=>c.page?`<button onclick="show('${c.page}')">${esc(c.label)}</button>`:`<span aria-current="page">${esc(c.label)}</span>`).join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
}
function recipeFilters(){
  const cuisines=[...new Set(state.recipes.map(r=>r.cuisine).filter(c=>typeof c==="string"&&c.trim()))].sort((a,b)=>a.localeCompare(b));
  return ["All","Quick",...cuisines];
}
function recipePillsHtml(){
  const filters=recipeFilters();
  if(!filters.includes(recipeFilter))recipeFilter="All";
  return filters.map(f=>`<button class="pill${recipeFilter===f?" active":""}" aria-pressed="${recipeFilter===f}" data-f="${esc(f)}" onclick="recipeFilterSet(this.dataset.f)">${esc(f)}</button>`).join("");
}
function recipeMatches(r){
  if(recipeFilter==="Quick"){const t=Number(r.cookingTime);if(!(t>0&&t<=30))return false}
  else if(recipeFilter!=="All"&&r.cuisine!==recipeFilter)return false;
  const words=recipeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return true;
  const ing=Array.isArray(r.ingredients)?r.ingredients.map(x=>typeof x==="string"?"":(x.name||x.text||"")):[];
  const hay=[r.name,r.cuisine,...ing].filter(Boolean).join(" ").toLowerCase();
  return words.every(w=>hay.includes(w));
}
function recipeListHtml(){
  const list=state.recipes.filter(recipeMatches);
  if(!state.recipes.length)return'<div class="empty">No recipes found.</div>';
  if(!list.length)return'<div class="empty">No recipes match your search.</div>';
  return list.map(r=>`<div class="card row" role="button" tabindex="0" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${[r.cuisine,cookTime(r.cookingTime),r.servings?`${r.servings} servings`:""].filter(Boolean).map(esc).join(" · ")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("");
}
function refreshRecipeList(){
  const list=byId("recipe-list");if(list)list.innerHTML=recipeListHtml();
  const clear=byId("recipe-search-clear");if(clear)clear.hidden=!recipeQuery;
}
function recipeSearch(value){recipeQuery=String(value||"");refreshRecipeList()}
function clearRecipeSearch(){recipeQuery="";const input=byId("recipe-search");if(input){input.value="";input.focus()}refreshRecipeList()}
function recipeFilterSet(name){recipeFilter=name;const pills=byId("recipe-filters");if(pills)pills.innerHTML=recipePillsHtml();refreshRecipeList()}
function recipes(){
  const pills=recipePillsHtml();
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Meals",page:"meals"},{label:"Recipes"}])}<div class="title-row"><h1 class="screen-title page-title">Recipes</h1><button class="plus" onclick="openImport()" aria-label="Add recipe from link">${icon("plus")}</button></div><div class="search-wrap">${icon("search")}<input id="recipe-search" type="search" value="${esc(recipeQuery)}" placeholder="Search recipes or ingredients" autocomplete="off" enterkeyhint="search" aria-label="Search recipes" oninput="recipeSearch(this.value)"><button class="search-clear" id="recipe-search-clear" aria-label="Clear search" onclick="clearRecipeSearch()"${recipeQuery?"":" hidden"}>${icon("x")}</button></div><div class="filterbar scroll" id="recipe-filters">${pills}</div><div id="recipe-list">${recipeListHtml()}</div></main>${nav("meals")}</div>`;
}
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
  const rawIng=Array.isArray(r.ingredients)?r.ingredients:[];
  const isRecId=x=>typeof x==="string"&&/^rec[A-Za-z0-9]{14}$/.test(x);
  const ing=rawIng.filter(x=>!isRecId(x));
  const staleWorker=rawIng.some(isRecId);
  const steps=methodSteps(r.recipeText);
  const t=ticksFor(r.id);
  if(isTablet())return cookView(r,ing,steps,t);
  const reset=`<button class="link" onclick="resetTicks('${esc(r.id)}')">Reset ticks</button>`;
  const source=/^https?:\/\//i.test(r.sourceUrl||"")?`<a class="link source-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")} View original recipe</a>`:"";
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Meals",page:"meals"},{label:"Recipes",page:"recipes"}])}<article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}" alt="">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px;color:var(--green)">${icon("soup","icon-thin")}</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>${icon("clock")} ${esc(cookTime(r.cookingTime))}</span>`:""}${r.servings?`<span>${icon("users")} ${esc(r.servings)} servings</span>`:""}${r.difficulty?`<span>${icon("chef-hat")} ${esc(r.difficulty)}</span>`:""}</div>${r.notes?`<p class="desc">${esc(r.notes)}</p>`:""}${source}${ing.length?`<div class="section-row"><h3>Ingredients</h3>${reset}</div>${ing.map((x,i)=>tickRow(r.id,"i",i,typeof x==="string"?x:(x.text||x.name||""),t.i.has(i))).join("")}`:""}${steps.length?`<div class="section-row"><h3>Method</h3>${ing.length?"":reset}</div>${steps.map((x,i)=>tickRow(r.id,"s",i,x,t.s.has(i))).join("")}`:""}${staleWorker?`<p class="desc">Ingredient names aren't available yet: the Worker needs updating to the latest version.</p>`:!ing.length&&!steps.length?`<p class="desc">No ingredients or method saved for this recipe yet.</p>`:""}<button class="action-btn m-meal" onclick="openPlanForm({recipeId:'${esc(r.id)}'})">${icon("calendar-plus")} Add to meal plan</button></div></article></main></div>`}
let todoFilter="All";
let todoSort="desc";

function todoStatusClass(status){
  const v=String(status||"To do").toLowerCase();
  return v.includes("done")?"done":v.includes("progress")?"progress":"todo";
}
function isOpen(t){return todoStatusClass(t.status)!=="done"}
function nextTodoStatus(status){
  const v=String(status||"To do").toLowerCase();
  if(v.includes("done")) return "To do";
  if(v.includes("progress")) return "Done";
  return "In progress";
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
      <div class="eyebrow">${t?.id?"Edit task":"New task"}</div>
      <h2 id="todo-form-title">${t?.id?"Edit to do":"Add a to do"}</h2>
      <label class="form-label" for="todo-task">Task</label>
      <input class="form-input" id="todo-task" maxlength="200" value="${esc(t?.task||"")}" placeholder="What needs doing?">
      <label class="form-label" for="todo-due">Due date</label>
      <input class="form-input" id="todo-due" type="date" value="${esc(t?.due||today())}">
      <label class="form-label" for="todo-category">Category</label>
      <select class="form-input" id="todo-category"><option value="">No category</option>${cats.map(c=>`<option value="${esc(c)}" ${c===category?"selected":""}>${esc(c)}</option>`).join("")}</select>
      <label class="form-label" for="todo-status">Status</label>
      <select class="form-input" id="todo-status">${statuses.map(x=>`<option value="${esc(x)}" ${String(x).toLowerCase()===String(status).toLowerCase()?"selected":""}>${esc(x)}</option>`).join("")}</select>
      <div class="form-actions"><button class="secondary-button" onclick="closeTodoForm()">Cancel</button><button class="primary-button" onclick="saveTodo('${esc(t?.id||"")}')">${t?.id?"Save changes":"Add task"}</button></div>
      ${t?.id?`<button class="danger-button" onclick="deleteTodo('${esc(t.id)}')">Delete task</button>`:""}
    </div>
  </div>`;
}
function openTodoForm(t=null){document.body.insertAdjacentHTML("beforeend",todoForm(t));setTimeout(()=>document.getElementById("todo-task")?.focus(),0)}
function closeTodoForm(){document.getElementById("todo-form-modal")?.remove()}
function todoRedraw(){if(currentPage==="planner")rerenderCal();else show("todo")}
async function saveTodo(id){
  const task=document.getElementById("todo-task")?.value.trim();
  const due=document.getElementById("todo-due")?.value||null;
  const category=document.getElementById("todo-category")?.value||null;
  const status=document.getElementById("todo-status")?.value||"To do";
  if(!task){toast("Enter a task");return}
  const body={task,due:todoDate(due),category,status};
  if(id){
    const i=state.todos.findIndex(x=>x.id===id);
    if(i>=0)state.todos[i]={...state.todos[i],...body,bucket:bucket({...state.todos[i],...body})};
    closeTodoForm();toast("Task updated");todoRedraw();
    try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(body)});markLoaded("todos")}
    catch(e){await load("todos",{force:true});todoRedraw();toast("Couldn't save task: "+e.message)}
  }else{
    try{
      const d=await api("/api/todos",{method:"POST",body:JSON.stringify(body)});
      if(d?.todo)state.todos.unshift({...d.todo,bucket:bucket(d.todo)});else invalidate("todos");
      closeTodoForm();toast("Task added");todoRedraw();
    }catch(e){toast("Couldn't save task: "+e.message)}
  }
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
  return plannerShell("todo","To do",`<div class="bd-editbar"><span class="sub">Tasks</span><button class="plus" onclick="openTodoForm()" aria-label="Add task">${icon("plus")}</button></div><div class="filterbar">${["All","Overdue","Today","Upcoming","Done"].map(x=>`<button class="pill ${todoFilter===x?"active":""}" aria-pressed="${todoFilter===x}" onclick="todoFilter='${x}';show('todo')">${x}</button>`).join("")}</div><div class="todo-toolbar"><span>Sort by due date</span><button class="sort-button" onclick="todoSort=todoSort==='desc'?'asc':'desc';show('todo')">${todoSort==='desc'?"Newest first "+icon("arrow-down"):"Oldest first "+icon("arrow-up")}</button></div>${sections||'<div class="empty">No tasks found.</div>'}`);
}
function editTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;openTodoForm(t);load("todo-options")}
async function toggleTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;const previous=t.status,status=nextTodoStatus(previous);t.status=status;t.bucket=bucket(t);todoRedraw();try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status})});markLoaded("todos")}catch(e){t.status=previous;t.bucket=bucket(t);todoRedraw();toast("Couldn't update task: "+e.message)}}
async function deleteTodo(id){if(!confirm("Delete this task?"))return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"DELETE"});state.todos=state.todos.filter(x=>x.id!==id);markLoaded("todos");closeTodoForm();toast("Task deleted");todoRedraw()}catch(e){toast("Couldn't delete task: "+e.message)}}
function events(){
  const groups=groupEventsByDay(state.events);
  const body=groups.length?groups.map(([dayKey,list])=>`<div class="todo-group"><b>${eventDayLabel(dayKey)}</b></div>${list.map(e=>`<div class="card row"><div class="event-time">${eventTimeLabel(e)}</div><div class="grow"><div class="title">${esc(e.title)}</div>${e.location?`<div class="sub">${esc(e.location)}</div>`:""}</div></div>`).join("")}`).join(""):'<div class="empty">No events in the next 14 days.</div>';
  return plannerShell("events","Events",`<div class="bd-editbar"><span class="sub">Next 14 days</span><a class="plus" href="https://calendar.google.com/calendar/u/0/r/eventedit" target="_blank" rel="noopener" aria-label="Add event">${icon("plus")}</a></div>${body}`);
}
/* ---- Planner calendar (v0.6.0): events, tasks due and meals; tabs Calendar / To do / Events ---- */
let calView=null,calSel=null,calEv={key:"",list:[]},calWanted="";
const calLayers={e:true,t:true,m:true};
const CAL_NAMES={e:"Events",t:"Tasks",m:"Meals"};
function plannerTabs(active){return `<div class="filterbar">${[["planner","Calendar"],["todo","To do"],["events","Events"]].map(([p,l])=>`<button class="pill${p===active?" active":""}"${p===active?' aria-current="page"':""} onclick="show('${p}')">${l}</button>`).join("")}</div>`}
function plannerShell(page,label,inner){return `<div class="shell">${header()}<main class="page${page==="planner"?" cal":""}">${crumbs([{label:"Planner",page:"planner"},{label}])}<h1 class="screen-title page-title">Planner</h1>${plannerTabs(page)}${inner}</main>${nav("planner")}</div>`}
function monthGrid(month){ // weeks start on Monday; the grid begins on the Monday on or before the 1st
  const [y,m]=month.split("-").map(Number),offset=(isoDate(`${month}-01`).getDay()+6)%7;
  return{start:shiftIso(`${month}-01`,-offset),weeks:Math.ceil((offset+new Date(y,m,0).getDate())/7)};
}
function weekLabel(start){
  const a=isoDate(start),b=isoDate(shiftIso(start,6)),mo=d=>d.toLocaleDateString("en-GB",{month:"short"});
  return a.getMonth()===b.getMonth()?`${a.getDate()} – ${b.getDate()} ${mo(b)} ${b.getFullYear()}`:`${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)} ${b.getFullYear()}`;
}
const calDayName=d=>isoDate(d).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
function calItems(date){
  const ev=calLayers.e?calEv.list.filter(e=>eventDayKey(e)===date).map(e=>({k:"e",e})):[];
  const tk=calLayers.t?state.todos.filter(t=>t.due===date).map(t=>({k:"t",t})):[];
  const ml=calLayers.m?state.mealPlan.filter(m=>m.date===date&&slotOf(m)).sort((x,y)=>MEALS.indexOf(slotOf(x))-MEALS.indexOf(slotOf(y))).map(m=>({k:"m",m})):[];
  return [...ev,...tk,...ml];
}
function calItem({k,e,t,m}){
  if(k==="e")return `<div class="cal-item e"><div class="grow"><div class="title">${esc(e.title)}</div><div class="sub">${esc(eventRange(e))}${e.location?` · ${esc(e.location)}`:""}</div></div></div>`;
  if(k==="t"){const sc=todoStatusClass(t.status),late=bucket(t)==="overdue";return `<div class="cal-item t" role="button" tabindex="0" onclick="editTodo('${esc(t.id)}')"><button class="check ${sc}" aria-label="Change task status" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title${sc==="done"?" completed":""}">${esc(t.task)}</div><div class="sub${late?" overdue-date":""}">${late?"Overdue":esc(t.category||"Task")}</div></div></div>`}
  return `<div class="cal-item m" role="button" tabindex="0" onclick="openPlanForm({id:'${esc(m.id)}'})"><div class="grow"><div class="title">${esc(recipeFor(m)?.name||"Recipe")}</div><div class="sub">${esc(slotOf(m))}${m.servings?` · ${m.servings==1?"1 serving":`${esc(m.servings)} servings`}`:""}</div></div></div>`;
}
function calEnsureEvents(from,days){
  const key=`${from}|${days}`;calWanted=key;
  if(calEv.key===key)return;
  api(`/api/events?from=${from}&days=${days}`).then(d=>d.events||[],()=>[]).then(list=>{if(calWanted!==key)return;calEv={key,list};rerenderCal()});
}
function calendar(){
  const view=calView||(isTablet()?"week":"month"),now=today(),sel=calSel||(calSel=now),month=sel.slice(0,7);
  const grid=monthGrid(month),wk=weekStartOf(isoDate(sel));
  if(view==="month")calEnsureEvents(grid.start,grid.weeks*7);else calEnsureEvents(wk,7);
  const title=view==="month"?isoDate(`${month}-01`).toLocaleDateString("en-GB",{month:"long",year:"numeric"}):weekLabel(wk);
  const head=`<div class="cal-nav"><div class="cal-step"><button aria-label="Previous ${view}" onclick="calStep(-1)">${icon("chevron-left")}</button><b>${title}</b><button aria-label="Next ${view}" onclick="calStep(1)">${icon("chevron-right")}</button><button class="cal-today" onclick="calToday()">Today</button></div><div class="seg" role="group" aria-label="View">${["month","week"].map(v=>`<button class="${v===view?"on":""}" aria-pressed="${v===view}" onclick="calSetView('${v}')">${v==="month"?"Month":"Week"}</button>`).join("")}</div></div><div class="cal-chips">${["e","t","m"].map(k=>`<button class="cal-chip ${k}${calLayers[k]?" on":""}" aria-pressed="${calLayers[k]}" onclick="calLayer('${k}')"><i></i>${CAL_NAMES[k]}</button>`).join("")}</div>`;
  let body;
  if(view==="month"){
    const cells=[...Array(grid.weeks*7)].map((_,i)=>{
      const d=shiftIso(grid.start,i),its=calItems(d),kinds=[...new Set(its.map(x=>x.k))];
      return `<button class="cal-cell${d.slice(0,7)!==month?" other":""}${d===sel?" sel":""}${d===now?" today":""}" aria-label="${esc(calDayName(d))}, ${its.length} item${its.length===1?"":"s"}" onclick="calPick('${d}')"><span>${isoDate(d).getDate()}</span><em>${kinds.map(k=>`<i class="${k}"></i>`).join("")}</em></button>`;
    }).join("");
    body=`<div class="cal-grid">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(n=>`<div class="cal-dow">${n}</div>`).join("")}${cells}</div><div class="row cal-agenda-head"><b>${esc(calDayName(sel))}</b><button class="cal-add" onclick="calAdd('${sel}')">+ Add</button></div>${calItems(sel).map(calItem).join("")||'<div class="sub" style="padding:8px 0">Nothing planned.</div>'}`;
  }else{
    body=`<div class="cal-week">${[...Array(7)].map((_,i)=>{
      const d=shiftIso(wk,i),dt=isoDate(d);
      return `<section class="cal-day${d===now?" today":""}"><div class="cal-day-head"><span>${dt.toLocaleDateString("en-GB",{weekday:"short"})} <b>${dt.getDate()}</b>${d===now?` <small class="cal-tag">· Today</small>`:""}</span><button class="cal-plus" aria-label="Add on ${esc(calDayName(d))}" onclick="calAdd('${d}')">+</button></div>${calItems(d).map(calItem).join("")||'<div class="sub">Nothing planned</div>'}</section>`;
    }).join("")}</div>`;
  }
  return plannerShell("planner","Calendar",head+body);
}
function rerenderCal(){if(currentPage!=="planner")return;const y=window.scrollY||0;byId("app").innerHTML=calendar();scrollTo(0,y)}
function calPick(d){calSel=d;rerenderCal()}
function calToday(){calSel=today();rerenderCal()}
function calSetView(v){calView=v;rerenderCal()}
function calLayer(k){calLayers[k]=!calLayers[k];rerenderCal()}
function calStep(dir){
  const view=calView||(isTablet()?"week":"month");
  if(view==="week")calSel=shiftIso(calSel,7*dir);
  else{const [y,m]=calSel.slice(0,7).split("-").map(Number);calSel=iso(new Date(y,m-1+dir,1))}
  rerenderCal();
}
function closeCalAdd(){byId("cal-add-modal")?.remove()}
function calAdd(d){
  closeCalAdd();
  const row=(ico,t,s,end)=>`<span class="cal-opt-ico">${icon(ico)}</span><span class="grow"><b>${t}</b><span class="sub">${s}</span></span>${icon(end)}`;
  document.body.insertAdjacentHTML("beforeend",`<div class="modal-backdrop sheet-bg" id="cal-add-modal"><div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="cal-add-title"><div class="eyebrow">Planner</div><h2 id="cal-add-title">Add on ${esc(calDayName(d))}</h2><button class="cal-opt" onclick="closeCalAdd();openTodoForm({due:'${d}'});load('todo-options')">${row("check","Add a task","Due that day","chevron-right")}</button><button class="cal-opt" onclick="closeCalAdd();openPlanForm({date:'${d}'})">${row("utensils","Add a meal","Pick a recipe and meal for the day","chevron-right")}</button><a class="cal-opt" href="https://calendar.google.com/calendar/u/0/r/eventedit?dates=${d.replaceAll("-","")}/${shiftIso(d,1).replaceAll("-","")}" target="_blank" rel="noopener" onclick="closeCalAdd()">${row("calendar-plus","Add an event","Opens Google Calendar","external-link")}</a><button class="secondary-button" onclick="closeCalAdd()">Cancel</button></div></div>`);
}
/* ---- Budget (v0.4.0) ---- */
const BUDGET_COLORS=["#0f806a","#e0a100","#6b4fb0","#c4573f","#2f7fb5","#9aa5ab","#b04f8f","#4f9a3a","#7a6a4f","#3f6f8f"];
function gbp(n){return "£"+(Number(n)||0).toLocaleString("en-GB",{maximumFractionDigits:0})}
function gbpShort(n){const v=Number(n)||0;return v>=1000?"£"+(v/1000).toFixed(1)+"k":"£"+Math.round(v)}
function monthShort(key){const [y,m]=key.split("-").map(Number);return new Date(y,m-1,1).toLocaleDateString("en-GB",{month:"short"})}
function budgetColor(id){const i=(state.budget?.categories||[]).findIndex(c=>c.id===id);return BUDGET_COLORS[(i<0?0:i)%BUDGET_COLORS.length]}
function budgetTone(pct){return pct>=100?"high":pct>=80?"mid":""}
function budgetAlertText(a){
  if(a.type==="over")return `<b>${esc(a.category)}</b> is ${gbp(a.amount)} over budget`;
  if(a.type==="near")return `<b>${esc(a.category)}</b> has used ${a.percent}% of its budget`;
  return `<b>${esc(a.category)}</b> is ${a.percent}% higher than the same point last month`;
}
function budgetBadge(){const n=state.budget?.alerts?.count||0;return n?`<span class="bd-badge" aria-label="${n} budget alert${n===1?"":"s"}">${n}</span>`:""}
function budgetTileSub(){
  const b=state.budget;if(!b||!b.hasBudget)return"Monthly spending";
  return b.totals.remaining>=0?`${gbp(b.totals.remaining)} left this month`:`${gbp(-b.totals.remaining)} over budget`;
}
function budgetAttentionHtml(){
  const a=state.budget?.alerts;if(!a||!a.count)return"";
  const more=a.count-1;
  return `<div class="section-head"><h2>Needs attention</h2></div><div class="card bd-attn" role="button" tabindex="0" onclick="show('budget')"><div class="title" style="font-weight:500">${budgetAlertText(a.items[0])}</div>${more?`<div class="sub">${more} more alert${more===1?"":"s"} in Budget</div>`:""}</div>`;
}
function budgetTabs(active){
  return `<div class="filterbar">${[["budget","Overview"],["budget-categories","Categories"],["budget-trends","Trends"]].map(([p,l])=>`<button class="pill${p===active?" active":""}"${p===active?' aria-current="page"':""} onclick="show('${p}')">${l}</button>`).join("")}</div>`;
}
function budgetShell(page,label,inner){
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Budget",page:"budget"},{label}])}<h1 class="screen-title page-title">Budget</h1>${budgetTabs(page)}${inner}</main>${nav("budget")}</div>`;
}
function budgetGate(){
  if(state.budget)return"";
  const msg=state.budgetError||"Unknown error",old=/not found|404/i.test(msg);
  return `<div class="card bd-card"><div class="title">Couldn't load the budget</div><p class="sub">${old?"Update your Worker to v0.4.0 or later.":esc(msg)}</p></div>`;
}
function budgetOverview(){
  const gate=budgetGate();if(gate)return budgetShell("budget","Overview",gate);
  const b=state.budget,t=b.totals,pct=Math.min(100,t.percent||0);
  const [y,m]=b.month.split("-").map(Number);
  const range=`1–${b.daysInMonth} ${monthShort(b.month)} ${y}`;
  const remainingBlock=b.hasBudget?(t.remaining>=0?`<div class="bd-right"><div class="sub">Remaining</div><div class="bd-big">${gbp(t.remaining)}</div></div>`:`<div class="bd-right"><div class="sub">Over budget by</div><div class="bd-big over">${gbp(-t.remaining)}</div></div>`):"";
  let html=`<div class="card bd-card"><div class="sub">This month · ${range}</div><div class="bd-row" style="margin-top:10px"><div><div class="sub">Spent</div><div class="bd-big">${gbp(t.spent)}</div></div>${remainingBlock}</div>${b.hasBudget?`<div class="bd-bar ${budgetTone(t.percent)}"><i style="width:${pct}%"></i></div><div class="sub">${t.percent}% of ${gbp(t.budget)} · day ${b.dayOfMonth} of ${b.daysInMonth}</div>`:`<p class="sub" style="margin-top:12px">No monthly budgets set yet. Add them in Airtable (Budget categories, Monthly budget). Set them under Categories, Edit budgets.</p>`}</div>`;
  html+=`<h2 class="bd-h">Alerts</h2>`;
  html+=b.alerts.count?`<div class="card bd-card">${b.alerts.items.map(a=>`<div class="bd-alert"><i class="bd-dot ${a.type}"></i><div>${budgetAlertText(a)}</div></div>`).join("")}</div>`:`<div class="card bd-card"><div class="sub">No alerts. You're on track.</div></div>`;
  const parts=b.categories.filter(c=>c.spent>0);
  html+=`<h2 class="bd-h">Spend by category</h2>`;
  if(!parts.length)html+=`<div class="card bd-card"><div class="sub">${b.transactionCount?"No categorised spend yet.":"No spend this month yet. Load your bank CSV into the Transactions table in Airtable."}</div></div>`;
  else{
    const C=2*Math.PI*40;let off=0;
    const segs=parts.map(c=>{const len=c.spent/t.spent*C,el=`<circle cx="50" cy="50" r="40" stroke="${budgetColor(c.id)}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;off+=len;return el}).join("");
    html+=`<div class="card bd-card bd-donut"><div class="bd-donut-wrap"><svg viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="Share of spend by category">${segs}</svg><div class="bd-donut-center"><div><b>${gbp(t.spent)}</b><span class="sub">spent</span></div></div></div><div class="bd-legend">${parts.map(c=>`<div><span><i style="background:${budgetColor(c.id)}"></i>${esc(c.name)}</span><b>${gbp(c.spent)}</b></div>`).join("")}</div></div>`;
  }
  if(b.unmatched)html+=`<p class="token-footnote">${b.unmatched} transaction${b.unmatched===1?"":"s"} had no matching merchant rule${b.unmatched===1?"":"s"}${b.fallbackName?` and ${b.unmatched===1?"was":"were"} counted as ${esc(b.fallbackName)}`:` and ${b.unmatched===1?"was":"were"} not counted. Add a category called Other to catch them`}. Add a Merchant rule in Airtable to categorise ${b.unmatched===1?"it":"them"}.</p>`;
  return budgetShell("budget","Overview",html);
}
function budgetCategories(){
  const gate=budgetGate();if(gate)return budgetShell("budget-categories","Categories",gate);
  const b=state.budget;
  if(!b.categories.length)return budgetShell("budget-categories","Categories",`${budgetEditBar()}<div class="empty">No categories yet. Use Edit budgets to add some.</div>`);
  const rows=b.categories.map(c=>{
    const has=c.budget>0,pct=Math.min(100,c.percent||0),over=c.alerts.find(a=>a.type==="over"),near=c.alerts.find(a=>a.type==="near"),rise=c.alerts.find(a=>a.type==="rising");
    let status,cls="";
    if(!has)status=c.spent>0?"No budget set":"No budget set · no spend yet";
    else if(over){status=`${gbp(over.amount)} over budget`;cls="over"}
    else if(near){status=`${c.percent}% used · nearing budget`;cls="near"}
    else status=`${c.percent}% used`;
    if(rise){status+=` · +${rise.percent}% vs last month`;if(!cls)cls="rising"}
    return `<div class="bd-cat"><div class="bd-row"><b>${esc(c.name)}</b><span class="bd-amt">${gbp(c.spent)}${has?` / ${gbp(c.budget)}`:""}</span></div><div class="bd-bar ${has?budgetTone(c.percent):""}"><i style="width:${has?pct:0}%"></i></div><div class="bd-status ${cls}">${esc(status)}</div></div>`;
  }).join("");
  return budgetShell("budget-categories","Categories",`${budgetEditBar()}<div class="card bd-card" style="padding-top:4px;padding-bottom:4px">${rows}</div>`);
}
function sparkline(series,color){
  if(series.length<2)return "";
  const w=64,h=24,lo=Math.min(...series),hi=Math.max(...series),span=hi-lo||1;
  const pts=series.map((v,i)=>[2+i*(w-4)/(series.length-1),h-2-(v-lo)/span*(h-4)]);
  const last=pts[pts.length-1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"/></svg>`;
}
function monthYear(key){const [y,m]=key.split("-").map(Number);return new Date(y,m-1,1).toLocaleDateString("en-GB",{month:"long",year:"numeric"})}
function budgetRollupNote(){
  const r=state.budget?.rollup;if(!r)return"";
  const pending=r.pendingMonths||[],day=state.budget.dayOfMonth;
  let text=r.historyUpTo?`History up to ${monthYear(r.historyUpTo)}`:"No history yet. The first roll-up runs on the 2nd.",cls="";
  if(pending.length&&day>=3){
    const list=pending.map(monthYear).join(", "),verb=pending.length===1?"is":"are";
    cls=" warn";
    text=r.needsOther?`${list} can't be rolled up yet. Add a category called Other so spend with no merchant rule can be counted.`:day>=10?`${list} couldn't be rolled up. Check the Worker's logs in Cloudflare.`:`${list} ${verb} waiting to be rolled up. It is retried on the 9th.`;
  }
  return `<p class="bd-rollup${cls}">${esc(text)}</p>`;
}
function budgetTrends(){
  const gate=budgetGate();if(gate)return budgetShell("budget-trends","Trends",gate);
  const b=state.budget,tr=b.trends,months=tr.months,budget=b.totals.budget;
  const H=100,max=Math.max(budget,...months.map(m=>m.total),1);
  const bl=budget>0?budget/max*H:0;
  let html=`<div class="card bd-card"><div class="bd-row"><b>Total spend</b><span class="sub">Last ${months.length} months</span></div><div class="bd-chart" style="height:${H+28}px">${budget>0?`<div class="bd-budget" style="bottom:${bl.toFixed(1)}px"></div><span class="bd-budget-label" style="bottom:${(bl+3).toFixed(1)}px">Budget ${gbp(budget)}</span>`:""}${months.map(m=>`<div class="bd-col"><div class="bd-total">${gbpShort(m.total)}</div><div class="bd-barfill${m.partial?" partial":""}" style="height:${(m.total/max*H).toFixed(1)}px"></div></div>`).join("")}</div><div class="bd-months">${months.map(m=>`<div>${monthShort(m.month)}${m.partial?"*":""}</div>`).join("")}</div><div class="sub" style="margin-top:8px;font-size:11px">* month to date, excluded from drift</div></div>`;
  html+=`<h2 class="bd-h" style="margin-bottom:2px">Category drift</h2>`;
  if(!tr.drift.length){
    html+=`<div class="card bd-card"><div class="sub">Drift appears once at least one month has closed. Trends build up as each month is rolled into Budget history.</div></div>`;
  }else{
    const need=tr.closedMonths<4;
    const lastKey=tr.closedKeys[tr.closedKeys.length-1];
    html+=`<div class="sub">${need?`Needs 4 closed months (${tr.closedMonths} so far)`:`${monthShort(lastKey)} vs the previous 3-month average · worst first`}</div>`;
    const rank=d=>d.change===null?-999:d.change;
    const rows=[...tr.drift].sort((a,b)=>rank(b)-rank(a)).map(d=>{
      const color=d.status==="rising"?"var(--red)":d.status==="falling"?"var(--green)":"var(--muted)";
      const chip=d.status==="rising"?`Rising +${d.change}%`:d.status==="falling"?`Falling −${Math.abs(d.change)}%`:d.status==="steady"?"Steady":"Building";
      const sub=d.average!==null?`${monthShort(lastKey)} ${gbp(d.last)} · avg ${gbp(d.average)}`:`${monthShort(lastKey)} ${gbp(d.last)}`;
      return `<div class="bd-drift"><div class="grow"><div class="title">${esc(d.name)}</div><div class="sub">${esc(sub)}</div></div>${sparkline(d.series,color)}<span class="chip ${d.status}">${chip}</span></div>`;
    }).join("");
    html+=`<div class="card bd-card" style="padding-top:0;padding-bottom:0;margin-top:8px">${rows}</div>`;
  }
  html+=budgetRollupNote();
  return budgetShell("budget-trends","Trends",html);
}
/* ---- Budget editing (v0.4.1) ---- */
let budgetDraft=null;
function budgetEditBar(){return `<div class="bd-editbar"><span class="sub">Monthly budgets</span><button class="bd-editbtn" onclick="openBudgetEdit()">${icon("pencil")} Edit budgets</button></div>`}
function budgetDraftTotal(){return (budgetDraft||[]).reduce((n,r)=>n+(Number(r.budget)>0?Number(r.budget):0),0)}
function budgetEditRowsHtml(){
  const last=budgetDraft.length-1;
  return budgetDraft.map((r,i)=>`<div class="bd-edit-row"><input class="form-input bd-edit-name" maxlength="60" aria-label="Category name" placeholder="Category name" value="${esc(r.name)}" oninput="budgetEditSet(${i},'name',this.value)"><label class="form-input bd-edit-amt"><span>£</span><input type="number" min="0" step="1" inputmode="decimal" aria-label="Monthly budget" placeholder="0" value="${esc(r.budget)}" oninput="budgetEditSet(${i},'budget',this.value)"></label><button class="bd-move" aria-label="Move up" onclick="budgetEditMove(${i},-1)"${i===0?" disabled":""}>${icon("chevron-up")}</button><button class="bd-move" aria-label="Move down" onclick="budgetEditMove(${i},1)"${i===last?" disabled":""}>${icon("chevron-down")}</button></div>`).join("");
}
function budgetEditHtml(){
  return `<div class="modal-backdrop sheet-bg" id="budget-edit-modal"><div class="modal sheet todo-form bd-sheet" role="dialog" aria-modal="true" aria-labelledby="budget-edit-title"><div class="eyebrow">Budget</div><h2 id="budget-edit-title">Edit budgets</h2><p class="sub" style="margin:0 0 12px">Monthly amount per category. Use the arrows to reorder. Spend with no matching rule goes to “Other”.</p><div class="bd-sheet-list" id="budget-edit-list">${budgetEditRowsHtml()}<button class="bd-add" onclick="budgetEditAdd()">+ Add category</button></div><div class="bd-sheet-foot"><p class="form-error" id="budget-edit-error" role="alert" hidden></p><div class="bd-row" style="margin-bottom:10px"><span class="sub" style="font-size:14px;margin:0">Total monthly budget</span><b class="bd-edit-total" id="budget-edit-total">${gbp(budgetDraftTotal())}</b></div><div class="form-actions"><button class="secondary-button" onclick="closeBudgetEdit()">Cancel</button><button class="primary-button" id="budget-edit-save" onclick="saveBudgetEdit()">Save budgets</button></div></div></div></div>`;
}
function openBudgetEdit(){
  if(!state.budget){toast("Budget isn't loaded yet");return}
  budgetDraft=state.budget.categories.map(c=>({id:c.id,name:c.name,budget:c.budget>0?String(c.budget):""}));
  closeBudgetEdit(true);
  document.body.insertAdjacentHTML("beforeend",budgetEditHtml());
}
function closeBudgetEdit(keepDraft){byId("budget-edit-modal")?.remove();if(!keepDraft)budgetDraft=null}
function budgetEditRefresh(){const el=byId("budget-edit-list");if(!el)return;const add=el.querySelector(".bd-add");el.querySelectorAll(".bd-edit-row").forEach(x=>x.remove());add.insertAdjacentHTML("beforebegin",budgetEditRowsHtml())}
function budgetEditTotal(){const el=byId("budget-edit-total");if(el)el.textContent=gbp(budgetDraftTotal())}
function budgetEditSet(i,key,value){if(!budgetDraft?.[i])return;budgetDraft[i][key]=value;if(key==="budget")budgetEditTotal()}
function budgetEditMove(i,dir){const j=i+dir;if(!budgetDraft||j<0||j>=budgetDraft.length)return;[budgetDraft[i],budgetDraft[j]]=[budgetDraft[j],budgetDraft[i]];budgetEditRefresh()}
function budgetEditAdd(){budgetDraft.push({id:null,name:"",budget:""});budgetEditRefresh();const rows=document.querySelectorAll("#budget-edit-list .bd-edit-row");const last=rows[rows.length-1];last?.scrollIntoView?.({block:"nearest"});last?.querySelector("input")?.focus()}
function budgetEditError(message){const el=byId("budget-edit-error");if(el){el.textContent=message;el.hidden=false}}
async function saveBudgetEdit(){
  if(!budgetDraft)return;
  const seen=new Set(),categories=[];
  for(const r of budgetDraft){
    const name=String(r.name||"").trim();
    if(!name){budgetEditError("Every category needs a name");return}
    if(seen.has(name.toLowerCase())){budgetEditError(`“${name}” is used twice`);return}
    seen.add(name.toLowerCase());
    const raw=String(r.budget??"").trim(),budget=raw===""?0:Number(raw);
    if(!(budget>=0&&budget<=100000)){budgetEditError(`Check the budget for “${name}”`);return}
    categories.push({id:r.id||undefined,name,budget});
  }
  const button=byId("budget-edit-save");
  if(button){button.disabled=true;button.textContent="Saving…"}
  try{
    await api("/api/budget/categories",{method:"POST",body:JSON.stringify({categories})});
    closeBudgetEdit();
    invalidate("budget");
    try{await load("budget",{force:true})}catch(e){}
    toast("Budgets saved");
    show(currentPage==="budget"?"budget":"budget-categories");
  }catch(e){
    if(button){button.disabled=false;button.textContent="Save budgets"}
    budgetEditError(/not found|404/i.test(e?.message||"")?"Update your Worker to v0.4.1 to save budgets.":(e?.message||"Couldn't save the budgets"));
  }
}
/* ---- Tablet (v0.5.0): side rail, dashboard Home, cooking view ---- */
const tabletQuery=matchMedia("(min-width:900px)");
function isTablet(){return tabletQuery.matches}
let currentId;
let wakeLock=null;
async function keepAwake(on){
  try{
    if(on&&!wakeLock&&navigator.wakeLock){wakeLock=await navigator.wakeLock.request("screen");wakeLock.addEventListener("release",()=>{wakeLock=null})}
    else if(!on&&wakeLock)await wakeLock.release();
  }catch{} // shortcut: if the browser refuses (battery saver, old OS) the screen sleeps normally
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")keepAwake(isTablet()&&(currentPage==="home"||currentPage==="recipe"))});

function clockText(){return new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}
const dashLink=(label,page)=>`<button class="dash-link" onclick="show('${page}')">${label}${icon("chevron-right")}</button>`;
const dashRow=(lead,title,sub,click)=>`<div class="dash-row"${click?` role="button" tabindex="0" onclick="${click}"`:""}>${lead}<div class="grow"><div>${title}</div>${sub?`<div class="sub">${sub}</div>`:""}</div></div>`;
const dashDay=d=>`<span class="dash-day">${isoDate(d).toLocaleDateString("en-GB",{weekday:"short"})}</span>`;
function eventRange(e){if(e.allDay)return"All day";const t=d=>new Date(d).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});return`${t(e.start)} – ${t(e.end)}`}
function dashBudget(){
  const b=state.budget;
  if(!b||!b.hasBudget)return`<div class="sub">${b?"No monthly budgets set yet.":"The budget isn't available."}</div>`;
  const t=b.totals,projected=t.spent/b.dayOfMonth*b.daysInMonth,over=projected-t.budget;
  const status=t.spent>t.budget?"over":over>0||t.percent>=80?"watch":"ok";
  const alerts=b.alerts.items.slice(0,3).map(a=>`<div class="bd-alert"><i class="bd-dot ${a.type}"></i><div>${budgetAlertText(a)}</div></div>`).join("");
  const updated=b.lastTransaction?` · updated ${isoDate(b.lastTransaction).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`:"";
  return `<div class="dash-title"><span class="sub" style="margin:0;font-size:15px">${monthShort(b.month)}${updated}</span><span class="dash-chip ${status}">${{over:"Over",watch:"Watch",ok:"On track"}[status]}</span></div><div class="bd-row"><div class="bd-big">${gbp(t.spent)}</div><span class="sub" style="font-size:16px">of ${gbp(t.budget)}</span></div><div class="bd-bar ${budgetTone(t.percent)}"><i style="width:${Math.min(100,t.percent||0)}%"></i></div><div class="bd-row sub"><span>${t.percent}% used</span><span>Day ${b.dayOfMonth} of ${b.daysInMonth}</span></div>${over>0&&status!=="over"?`<div class="dash-insight"><b>Spending is running ahead of plan</b><br>At this pace, month end is about ${gbp(projected)}, around ${gbp(over)} over budget.</div>`:""}${alerts?`<div class="dash-label">ALERTS</div>${alerts}`:""}`;
}
function dashboard(){
  const period=dayPeriod(),key=today(),weekEnd=shiftIso(key,6);
  const events=state.events.filter(e=>eventDayKey(e)===key);
  const tasks=state.todos.filter(t=>isOpen(t)&&(t.bucket==="today"||t.bucket==="tomorrow")).slice(0,4);
  const overdue=state.todos.filter(t=>isOpen(t)&&t.bucket==="overdue");
  const dinner=state.mealPlan.find(m=>m.date===key&&slotOf(m)==="Dinner"),dr=recipeFor(dinner);
  const others=state.mealPlan.filter(m=>m.date===key&&slotOf(m)!=="Dinner"&&recipeFor(m)).sort((x,y)=>(slotOf(x)==="Lunch")-(slotOf(y)==="Lunch"));
  const next=[1,2,3].map(n=>{const d=shiftIso(key,n),m=state.mealPlan.find(x=>x.date===d&&slotOf(x)==="Dinner");return{d,r:recipeFor(m)}}).filter(x=>x.r);
  const soon=state.events.filter(e=>eventDayKey(e)>key&&eventDayKey(e)<=weekEnd).slice(0,4);
  const ico=c=>`<div class="dash-ico" style="background:${c}">${icon("calendar-days")}</div>`;
  const card=(title,link,inner)=>`<section class="dash-card"><div class="dash-title"><h2>${title}</h2>${link}</div>${inner}</section>`;
  const today_=card("Today",dashLink("Planner","planner"),`${events.length?`<div class="dash-label">EVENTS</div>${events.map(e=>dashRow(ico("var(--lav)"),esc(e.title),esc(eventRange(e)),"show('events')")).join("")}`:""}${tasks.length?`<div class="dash-label">TASKS DUE</div>${tasks.map(t=>dashRow('<i class="check"></i>',esc(t.task),t.bucket==="today"?"Today":"Tomorrow","show('todo')")).join("")}`:""}${!events.length&&!tasks.length?`<div class="sub" style="padding:8px 0">Nothing on today.</div>`:""}${overdue.length?`<div class="dash-alert" role="button" tabindex="0" onclick="show('todo')">${icon("info")}<div><b>${overdue.length} overdue task${overdue.length===1?"":"s"}</b><div class="sub" style="margin:0">${esc(overdue[0].task)}</div></div></div>`:""}`);
  const mealRows=others.map(m=>dashRow(`<span class="dash-day">${esc(slotOf(m))}</span>`,esc(recipeFor(m).name),"",`show('recipe','${esc(m.recipeId)}')`)).join("");
  const nextRows=next.map(x=>dashRow(dashDay(x.d),esc(x.r.name),"Dinner",`show('recipe','${esc(x.r.id)}')`)).join("");
  const extra=(mealRows?`<div class="dash-label">ALSO TODAY</div>${mealRows}`:"")+(nextRows?`<div class="dash-label">NEXT 3 DAYS</div>${nextRows}`:"");
  const hero=dr?`${dr.image?`<img class="dash-img" src="${esc(dr.image)}" alt="">`:`<div class="dash-img">${icon("soup","icon-thin")}</div>`}<div class="dash-name">${esc(dr.name)}</div><div class="sub">${[cookTime(dr.cookingTime),`${dinner.servings||dr.servings||""} servings`].filter(Boolean).map(esc).join(" · ")}</div><button class="secondary-button" onclick="show('recipe','${esc(dr.id)}')">View recipe${icon("chevron-right")}</button>`:`<div class="sub" style="padding:8px 0 12px">Nothing planned for tonight.</div><button class="secondary-button" onclick="show('plan')">Plan a meal</button>`;
  const dinner_=card("Tonight’s dinner",dashLink("Meals","meals"),hero+extra);
  const budget_=card("Budget",dashLink("Budget","budget"),dashBudget());
  const soon_=card("Coming up",dashLink("Planner","planner"),soon.length?soon.map(e=>dashRow(dashDay(eventDayKey(e)),esc(e.title),esc(eventTimeLabel(e)),"show('events')")).join(""):`<div class="sub" style="padding:8px 0">Nothing in the next week.</div>`);
  return `<div class="shell"><main class="page dash"><div class="dash-head"><div><div class="eyebrow">${greetingText(period)},</div><div class="hello">The Wilsons <span class="sun">${icon(greetingIcon(period))}</span></div></div><div class="dash-clock"><div><div class="clock" id="clock">${clockText()}</div><div class="sub">${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}</div></div><button class="avatar" onclick="show('settings')" aria-label="Settings" title="Settings">${icon("settings")}</button></div></div><div class="dash-grid"><div class="dash-col">${today_}</div><div class="dash-col">${dinner_}</div><div class="dash-col">${budget_}${soon_}</div></div></main>${nav("home")}</div>`;
}

/* Cooking view: ingredients and method side by side, servings, timers, focus mode */
const cookServings={};
function ingredientText(x,f){
  if(typeof x==="string"||f===1||x.quantity===null||x.quantity===undefined)return typeof x==="string"?x:(x.text||x.name||"");
  const u=String(x.unit||""),tight=["g","kg","ml","l"].includes(u.toLowerCase());
  return `${Math.round(Number(x.quantity)*f*100)/100}${u?`${tight?"":" "}${u}`:""} ${x.name}${x.preparation?`, ${x.preparation}`:""}${x.optional?" (optional)":""}`;
}
// shortcut: reads "N minutes/hours" only ("1 hour 30 minutes" gives 60 and 30; a range like "10-15 min" gives 10)
function stepDurations(text){
  const out=[];
  for(const m of String(text).matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/gi)){
    const v=Math.round(/^h/i.test(m[2])?parseFloat(m[1])*60:parseFloat(m[1]));
    if(v>0&&!out.includes(v))out.push(v);
  }
  return out;
}
function cookData(r){
  const ing=(r.ingredients||[]).filter(x=>!(typeof x==="string"&&/^rec[A-Za-z0-9]{14}$/.test(x)));
  const n=cookServings[r.id]??r.servings;
  return{ing,steps:methodSteps(r.recipeText),n,f:r.servings&&n?n/r.servings:1};
}
function cookServe(id,d){const r=state.recipes.find(x=>x.id===id);cookServings[id]=Math.min(99,Math.max(1,(cookServings[id]??r.servings)+d));show("recipe",id)}
function cookView(r,ing,steps,t){
  const {n,f}=cookData(r),id=esc(r.id),current=steps.findIndex((_,i)=>!t.s.has(i));
  const source=/^https?:\/\//i.test(r.sourceUrl||"")?`<a class="link source-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")} View original recipe</a>`:"";
  const stepper=r.servings?`<div class="stepper"><button aria-label="Fewer servings" onclick="cookServe('${id}',-1)">${icon("minus")}</button><span>${n} servings</span><button aria-label="More servings" onclick="cookServe('${id}',1)">${icon("plus")}</button></div>`:"";
  return `<div class="shell"><main class="page cook">${crumbs([{label:"Meals",page:"meals"},{label:"Recipes",page:"recipes"}])}<div class="cook-head"><div><h1 class="screen-title">${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>${icon("clock")} ${esc(cookTime(r.cookingTime))}</span>`:""}${navigator.wakeLock?`<span>${icon("sun")} Screen stays on</span>`:""}</div>${source}</div><div class="cook-actions">${stepper}<button class="secondary-button cook-btn" onclick="openPlanForm({recipeId:'${id}'})">${icon("calendar-plus")} Add to plan</button>${steps.length?`<button class="primary-button cook-btn" onclick="openFocus('${id}')">${icon("chef-hat")} Focus mode</button>`:""}</div></div>
<div class="cook-cols"><section class="card cook-card"><div class="section-row"><h3>Ingredients</h3><button class="link" onclick="resetTicks('${id}')">Reset ticks</button></div>${ing.map((x,i)=>tickRow(r.id,"i",i,ingredientText(x,f),t.i.has(i))).join("")||'<p class="desc">No ingredients saved.</p>'}</section><section class="card cook-card"><div class="section-row"><h3>Method</h3></div>${steps.map((x,i)=>`<div class="step${i===current?" current":""}">${tickRow(r.id,"s",i,x,t.s.has(i))}${stepDurations(x).map(m=>`<button class="secondary-button cook-timer" onclick="startTimer('Step ${i+1} · ${m} min',${m})">${icon("clock")} Start ${m} min timer</button>`).join("")}</div>`).join("")||'<p class="desc">No method saved.</p>'}</section></div><div class="timers-bar js-timers">${timersInner()}</div></main>${nav("meals")}</div>`;
}

/* Timers (kept in memory: they carry on while you browse, and are lost on reload) */
let timers=[],timerSeq=0,timerLoop=null,audioCtx=null;
const timerLeft=t=>t.left!==null?t.left:Math.max(0,t.end-Date.now());
function timerClock(t){
  if(t.done)return"Done";
  const s=Math.ceil(timerLeft(t)/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,"0");
  return h?`${h}:${String(m).padStart(2,"0")}:${x}`:`${m}:${x}`;
}
function timersInner(){
  return timers.map(t=>`<div class="timer${t.done?" done":""}"><b>${esc(t.label)}</b><span class="timer-time" data-t="${t.id}">${timerClock(t)}</span>${t.done?"":`<button onclick="timerToggle(${t.id})">${t.left!==null?"Resume":"Pause"}</button><button onclick="timerAdd(${t.id})">+1 min</button>`}<button aria-label="Dismiss timer" onclick="timerDismiss(${t.id})">${icon("x")}</button></div>`).join("");
}
function renderTimers(){
  document.querySelectorAll(".js-timers").forEach(el=>{el.innerHTML=timersInner()});
  if(byId("focus"))renderFocus();
}
function startTimer(label,minutes){
  timers.push({id:++timerSeq,label,end:Date.now()+minutes*60000,left:null,done:false});
  try{audioCtx=audioCtx||new AudioContext();audioCtx.resume()}catch{} // browsers only allow sound after a tap
  timerLoop=timerLoop||setInterval(tickTimers,1000);
  renderTimers();
}
function tickTimers(){
  const finished=timers.filter(t=>!t.done&&t.left===null&&t.end<=Date.now());
  finished.forEach(t=>{t.done=true});
  if(finished.length){beep();renderTimers();return}
  document.querySelectorAll("[data-t]").forEach(el=>{const t=timers.find(x=>x.id===Number(el.dataset.t));if(t)el.textContent=timerClock(t)});
}
function beep(){
  navigator.vibrate?.([300,150,300]);
  try{[0,.8,1.6].forEach(d=>{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);g.gain.value=.25;o.frequency.value=880;o.start(audioCtx.currentTime+d);o.stop(audioCtx.currentTime+d+.5)})}catch{}
}
function timerToggle(id){const t=timers.find(x=>x.id===id);if(!t)return;if(t.left!==null){t.end=Date.now()+t.left;t.left=null}else t.left=Math.max(0,t.end-Date.now());renderTimers()}
function timerAdd(id){const t=timers.find(x=>x.id===id);if(!t)return;if(t.left!==null)t.left+=60000;else t.end+=60000;renderTimers()}
function timerDismiss(id){timers=timers.filter(x=>x.id!==id);if(!timers.length){clearInterval(timerLoop);timerLoop=null}renderTimers()}

/* Focus mode: one step at a time */
let focus=null;
function openFocus(id){
  const r=state.recipes.find(x=>x.id===id);if(!r)return;
  const {steps}=cookData(r),t=ticksFor(id),first=steps.findIndex((_,i)=>!t.s.has(i));
  if(!steps.length)return;
  focus={id,i:first<0?0:first};renderFocus();
}
function closeFocus(){byId("focus")?.remove();const id=focus?.id;focus=null;if(currentPage==="recipe")show("recipe",id)}
function focusStep(dir){
  const r=state.recipes.find(x=>x.id===focus.id),{steps}=cookData(r),t=ticksFor(r.id);
  if(dir>0){t.s.add(focus.i);writeTicks(r.id,t);if(focus.i>=steps.length-1){closeFocus();return}focus.i++}
  else if(focus.i>0){focus.i--;t.s.delete(focus.i);writeTicks(r.id,t)}
  renderFocus();
}
function renderFocus(){
  const r=state.recipes.find(x=>x.id===focus.id),{ing,steps,f}=cookData(r),step=steps[focus.i];
  const low=step.toLowerCase();
  const chips=ing.filter(x=>String(x.name||"").toLowerCase().split(/\s+/).some(w=>w.length>3&&low.includes(w.replace(/s$/,"")))).map(x=>`<span>${esc(ingredientText(x,f))}</span>`).join("");
  const timer=stepDurations(step).map(m=>{
    const label=`Step ${focus.i+1} · ${m} min`,run=timers.find(x=>x.label===label);
    return run?`<div class="card focus-timer"><div class="sub">${m} min</div><span class="timer-time" data-t="${run.id}">${timerClock(run)}</span><div class="focus-actions">${run.done?`<button class="secondary-button" onclick="timerDismiss(${run.id})">Dismiss</button>`:`<button class="secondary-button" onclick="timerToggle(${run.id})">${run.left!==null?"Resume":"Pause"}</button><button class="secondary-button" onclick="timerAdd(${run.id})">+1 min</button>`}</div></div>`:`<div class="card focus-timer"><div class="sub">${m} min</div><button class="primary-button" onclick="startTimer('${label}',${m})">${icon("clock")} Start timer</button></div>`;
  }).join("");
  let el=byId("focus");
  if(!el){el=document.createElement("div");el.id="focus";el.className="focus";el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");el.setAttribute("aria-label","Focus mode");document.body.appendChild(el)}
  const last=focus.i>=steps.length-1;
  el.innerHTML=`<div class="focus-top"><div><b>${esc(r.name)}</b> · Step ${focus.i+1} of ${steps.length}${r.servings?` · ${cookData(r).n} servings`:""}<div class="bd-bar"><i style="width:${(focus.i+1)/steps.length*100}%"></i></div></div><button class="secondary-button" onclick="closeFocus()">Exit focus</button></div><div class="focus-body"><div class="focus-text">${esc(step)}${chips?`<div class="focus-chips">${chips}</div>`:""}</div>${timer?`<div class="focus-timers">${timer}</div>`:""}</div><div class="timers-bar js-timers">${timersInner()}</div><div class="focus-nav"><button class="secondary-button" onclick="focusStep(-1)"${focus.i===0?" disabled":""}>Back</button><button class="primary-button" onclick="focusStep(1)">${last?"Finish":"Next step"}</button></div>`;
}
function toast(s){const x=document.createElement("div");x.className="toast";x.setAttribute("role","status");x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
const MODAL_CLOSE={"connection-modal":closeConnectionModal,"plan-form-modal":closePlanForm,"todo-form-modal":closeTodoForm,"import-modal":closeImport,"cal-add-modal":closeCalAdd,"budget-edit-modal":closeBudgetEdit};
let pressedBackdrop=false; // a drag that starts inside a form and ends outside must not close it
document.addEventListener("pointerdown",e=>{pressedBackdrop=!!e.target.classList?.contains("modal-backdrop")});
document.addEventListener("click",e=>{if(pressedBackdrop&&e.target.classList?.contains("modal-backdrop"))MODAL_CLOSE[e.target.id]?.()});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&byId("focus"))closeFocus();
  else if(e.key==="Escape")MODAL_CLOSE[[...document.querySelectorAll(".modal-backdrop")].pop()?.id]?.();
  else if((e.key==="Enter"||e.key===" ")&&e.target.matches?.('[role="button"]')){e.preventDefault();e.target.click()}
});
function errorScreen(e){return `<div class="shell">${header(true)}<main class="page"><div class="card" style="padding:20px"><div class="eyebrow">Connection problem</div><h2>Daily Life couldn't reach the Worker.</h2><p class="sub">${esc(e?.message||"Unknown error")}</p><p class="sub">Check DAILY_LIFE_API and DAILY_LIFE_APP_TOKEN in app.js.</p><button class="action-btn m-meal" onclick="show('home')">Try again</button></div></main>${nav("home")}</div>`}
// Data each screen needs: loaded first if missing, then refreshed in the background.
const SCREEN_DATA={home:["recipes","todos","mealPlan","events","budget"],plan:["recipes","mealPlan"],planner:["recipes","todos","mealPlan"],recipes:["recipes"],todo:["todos"],events:["events"],budget:["budget"],"budget-categories":["budget"],"budget-trends":["budget"]};
// Shown at once; refreshed in the background only if already loaded.
const SOFT_DATA={meals:["recipes"],recipe:["recipes"]};
const SCREENS={home,recipes,events,meals,plan,planner:calendar,settings,usage:usageScreen,"release-notes":releaseNotesScreen,budget:budgetOverview,"budget-categories":budgetCategories,"budget-trends":budgetTrends};
async function show(page,id){
  scrollTo(0,0);currentPage=page;currentId=id;const app=document.getElementById("app");
  try{
    if(page==="token"||!hasAppToken()){app.innerHTML=tokenScreen();return}
    const need=SCREEN_DATA[page]||[];
    if(need.some(k=>!cacheMeta[k].loaded)){app.innerHTML='<div class="shell loading">Loading…</div>';await Promise.all(need.map(k=>load(k)))}
    app.innerHTML=page==="recipe"?await recipe(id):(SCREENS[page]||todo)();
    if(page==="home")loadLinks();
    keepAwake(isTablet()&&(page==="home"||page==="recipe"));
    if(page==="usage"||page==="settings"&&!apiUsage)loadUsage();
    if(page==="release-notes"||page==="settings"&&!releaseNotes)loadReleaseNotes();
    if(page==="todo"&&!cacheMeta["todo-options"].loaded)load("todo-options",{background:true});
    refreshDataInBackground(need.length?need:SOFT_DATA[page]||[]);
  }catch(e){console.error(e);app.innerHTML=errorScreen(e)}
}
tabletQuery.addEventListener("change",()=>show(currentPage,currentId));
setInterval(()=>{const c=byId("clock");if(c)c.textContent=clockText()},15000);
if(!window.location.hash)show("home");
