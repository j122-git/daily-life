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
function nav(a){return `<nav class="bottom"><button class="nav ${a==="home"?"active":""}" onclick="show('home')"><span class="ni">${icon("house")}</span>Home</button><button class="nav ${a==="meals"?"active":""}" onclick="show('meals')"><span class="ni">${icon("utensils")}</span>Meals</button><button class="nav ${a==="planner"?"active":""}" onclick="show('planner')"><span class="ni">${icon("clipboard-list")}</span>Planner</button><button class="nav ${a==="settings"?"active":""}" onclick="show('settings')"><span class="ni">${icon("ellipsis")}</span>More</button></nav>`}
function header(title="",back=false,backTo="home",cog=false){return `<header class="header">${back?`<button class="back" onclick="show('${backTo}')" aria-label="Back">${icon("chevron-left")}</button>`:`<div class="logo">Daily Life</div>`}<h1 class="screen-title">${back?esc(title):""}</h1>${cog?`<button class="avatar" onclick="show('settings')" aria-label="Settings" title="Settings">${icon("settings")}</button>`:""}</header>`}
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
  const r=recipeFor(m),name=r?.name||m.recipeName||"Recipe",id=esc(m.id);
  return `<div class="plan-item${m.cooked?" cooked":""}"><button class="plan-tick${m.cooked?" ticked":""}" aria-label="Mark as cooked" aria-pressed="${!!m.cooked}" onclick="toggleCooked('${id}',this)"><span class="tick-circle"></span></button><div class="plan-main"${r?` onclick="show('recipe','${esc(r.id)}')"`:""}><div class="plan-title">${esc(name)}</div>${m.servings?`<div class="sub">${esc(m.servings)} servings</div>`:""}</div><button class="plan-more" aria-label="Edit meal" onclick="openPlanForm({id:'${id}'})">${icon("ellipsis")}</button></div>`;
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
    const r=recipeFor(m),title=r?.name||m.recipeName;
    if(!title)return"";
    return `<div class="card row"${r?` onclick="show('recipe','${esc(r.id)}')"`:""}>${r?img(r):""}<div class="grow"><div class="eyebrow">${esc(slotOf(m)||m.meal||"Meal")}</div><div class="title">${esc(title)}</div></div>${r?`<div class="chev">${icon("chevron-right")}</div>`:""}</div>`;
  }).join("");
  return rows||`<div class="card" style="padding:18px"><div class="sub">Nothing planned for today.</div></div>`;
}
function home(){const ts=state.todos.filter(t=>t.bucket==="today"&&t.status!=="Done").slice(0,3),ec=eventsUpcoming(7).length,openTasks=state.todos.filter(t=>t.status!=="Done").length,period=dayPeriod();return `<div class="shell">${header("",false,"home",true)}<main class="page"><div class="eyebrow">${greetingText(period)},</div><div class="hello">The Wilsons <span class="sun">${icon(greetingIcon(period))}</span></div><div class="modules"><button class="module m-meal" onclick="show('meals')"><div class="ico">${icon("utensils")}</div><div class="module-title">Meals</div><div class="module-sub">Recipes and meal plan<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-todo" onclick="show('planner')"><div class="ico">${icon("clipboard-list")}</div><div class="module-title">Planner</div><div class="module-sub">${openTasks} task${openTasks===1?"":"s"} · ${ec} event${ec===1?"":"s"}<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-family" onclick="openDocuments()"><div class="ico">${icon("folder")}</div><div class="module-title">Documents</div><div class="module-sub">Open in Drive<span class="chev">${icon("external-link")}</span></div></button><button class="module m-events" onclick="toast('Budget coming soon')"><div class="ico">${icon("wallet")}</div><div class="module-title">Budget</div><div class="module-sub">Coming soon<span class="chev">${icon("chevron-right")}</span></div></button></div><div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>${todayMealsHtml()}${ts.map(t=>`<div class="card row" onclick="show('todo')"><button class="check" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.category||"")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("")}</main>${nav("home")}</div>`}
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
function planner(){
  const open=state.todos.filter(t=>t.status!=="Done").length,ec=eventsUpcoming(7).length;
  const todoSub=cacheMeta.todos.loaded?`${open} task${open===1?"":"s"}`:"Tasks and chores";
  const eventsSub=cacheMeta.events.loaded?`${ec} this week`:"What's on";
  return `<div class="shell">${header()}<main class="page"><h1 class="screen-title page-title">Planner</h1><div class="modules"><button class="module m-todo" onclick="show('todo')"><div class="ico">${icon("clipboard-list")}</div><div class="module-title">To do</div><div class="module-sub">${todoSub}<span class="chev">${icon("chevron-right")}</span></div></button><button class="module m-events" onclick="show('events')"><div class="ico">${icon("calendar-days")}</div><div class="module-title">Events</div><div class="module-sub">${eventsSub}<span class="chev">${icon("chevron-right")}</span></div></button></div></main>${nav("planner")}</div>`;
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
  return filters.map(f=>`<button class="pill${recipeFilter===f?" active":""}" data-f="${esc(f)}" onclick="recipeFilterSet(this.dataset.f)">${esc(f)}</button>`).join("");
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
  return list.map(r=>`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${[r.cuisine,cookTime(r.cookingTime),r.servings?`${r.servings} servings`:""].filter(Boolean).map(esc).join(" · ")}</div></div><div class="chev">${icon("chevron-right")}</div></div>`).join("");
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
  const reset=`<button class="link" onclick="resetTicks('${esc(r.id)}')">Reset ticks</button>`;
  const source=/^https?:\/\//i.test(r.sourceUrl||"")?`<a class="link source-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")} View original recipe</a>`:"";
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Meals",page:"meals"},{label:"Recipes",page:"recipes"}])}<article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}" alt="">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px;color:var(--green)">${icon("soup","icon-thin")}</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>${icon("clock")} ${esc(cookTime(r.cookingTime))}</span>`:""}${r.servings?`<span>${icon("users")} ${esc(r.servings)} servings</span>`:""}${r.difficulty?`<span>${icon("chef-hat")} ${esc(r.difficulty)}</span>`:""}</div>${r.notes?`<p class="desc">${esc(r.notes)}</p>`:""}${source}${ing.length?`<div class="section-row"><h3>Ingredients</h3>${reset}</div>${ing.map((x,i)=>tickRow(r.id,"i",i,typeof x==="string"?x:(x.text||x.name||""),t.i.has(i))).join("")}`:""}${steps.length?`<div class="section-row"><h3>Method</h3>${ing.length?"":reset}</div>${steps.map((x,i)=>tickRow(r.id,"s",i,x,t.s.has(i))).join("")}`:""}${staleWorker?`<p class="desc">Ingredient names aren't available yet: the Worker needs updating to the latest version.</p>`:!ing.length&&!steps.length?`<p class="desc">No ingredients or method saved for this recipe yet.</p>`:""}<button class="action-btn m-meal" onclick="openPlanForm({recipeId:'${esc(r.id)}'})">${icon("calendar-plus")} Add to meal plan</button></div></article></main></div>`}
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
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Planner",page:"planner"},{label:"To do"}])}<div class="title-row"><h1 class="screen-title page-title">To do</h1><button class="plus" onclick="openTodoForm()" aria-label="Add task">${icon("plus")}</button></div><div class="filterbar">${["All","Overdue","Today","Upcoming","Done"].map(x=>`<button class="pill ${todoFilter===x?"active":""}" onclick="todoFilter='${x}';show('todo')">${x}</button>`).join("")}</div><div class="todo-toolbar"><span>Sort by due date</span><button class="sort-button" onclick="todoSort=todoSort==='desc'?'asc':'desc';show('todo')">${todoSort==='desc'?"Newest first "+icon("arrow-down"):"Oldest first "+icon("arrow-up")}</button></div>${sections||'<div class="empty">No tasks found.</div>'}</main>${nav("planner")}</div>`;
}
function editTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;openTodoForm(t);load("todo-options")}
async function toggleTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;const previous=t.status,status=nextTodoStatus(previous);t.status=status;t.bucket=bucket(t);show("todo");try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status})});markLoaded("todos")}catch(e){t.status=previous;t.bucket=bucket(t);show("todo");toast("Couldn't update task: "+e.message)}}
async function deleteTodo(id){if(!confirm("Delete this task?"))return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"DELETE"});state.todos=state.todos.filter(x=>x.id!==id);markLoaded("todos");closeTodoForm();toast("Task deleted");show("todo")}catch(e){toast("Couldn't delete task: "+e.message)}}
function events(){
  const groups=groupEventsByDay(state.events);
  const body=groups.length?groups.map(([dayKey,list])=>`<div class="todo-group"><b>${eventDayLabel(dayKey)}</b></div>${list.map(e=>`<div class="card row"><div class="event-time">${eventTimeLabel(e)}</div><div class="grow"><div class="title">${esc(e.title)}</div>${e.location?`<div class="sub">${esc(e.location)}</div>`:""}</div></div>`).join("")}`).join(""):'<div class="empty">No events in the next 14 days.</div>';
  return `<div class="shell">${header()}<main class="page">${crumbs([{label:"Planner",page:"planner"},{label:"Events"}])}<div class="title-row"><h1 class="screen-title page-title">Events</h1><a class="plus" href="https://calendar.google.com/calendar/u/0/r/eventedit" target="_blank" rel="noopener" aria-label="Add event">${icon("plus")}</a></div>${body}</main>${nav("planner")}</div>`;
}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
function errorScreen(e){return `<div class="shell">${header("",false,"home",true)}<main class="page"><div class="card" style="padding:20px"><div class="eyebrow">Connection problem</div><h2>Daily Life couldn't reach the Worker.</h2><p class="sub">${esc(e?.message||"Unknown error")}</p><p class="sub">Check DAILY_LIFE_API and DAILY_LIFE_APP_TOKEN in app.js.</p><button class="action-btn m-meal" onclick="show('home')">Try again</button></div></main>${nav("home")}</div>`}
async function show(page,id){
  scrollTo(0,0);currentPage=page;const app=document.getElementById("app");
  try{
    if(page==="token"){app.innerHTML=tokenScreen();return}
    if(!hasAppToken()){app.innerHTML=tokenScreen();return}
    if(page==="home"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await all()}
    else if(page==="plan"&&!(cacheMeta.mealPlan.loaded&&cacheMeta.recipes.loaded)){app.innerHTML='<div class="shell loading">Loading…</div>';await Promise.all([load("recipes"),load("mealPlan")])}
    else if(page==="planner"&&!(cacheMeta.todos.loaded&&cacheMeta.events.loaded)){app.innerHTML='<div class="shell loading">Loading…</div>';await Promise.all([load("todos"),load("events")])}
    else if(page==="recipes"&&!cacheMeta.recipes.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("recipes")}
    else if(page==="todo"&&!cacheMeta.todos.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("todos")}
    else if(page==="events"&&!cacheMeta.events.loaded){app.innerHTML='<div class="shell loading">Loading…</div>';await load("events")}
    let h;if(page==="home")h=home();else if(page==="recipes")h=recipes();else if(page==="recipe")h=await recipe(id);else if(page==="events")h=events();else if(page==="meals")h=meals();else if(page==="plan")h=plan();else if(page==="planner")h=planner();else if(page==="settings")h=settings();else if(page==="usage")h=usageScreen();else if(page==="release-notes")h=releaseNotesScreen();else h=todo();
    app.innerHTML=h;
    if(page==="usage")loadUsage();
    if(page==="home")loadLinks();
    if(page==="planner")refreshDataInBackground(["todos","events"]);
    if(page==="release-notes"||page==="settings"&&!releaseNotes)loadReleaseNotes();
    if(page==="settings"&&!apiUsage)loadUsage();
    if(page==="home")refreshDataInBackground(["recipes","todos","mealPlan","events"]);
    if(page==="meals"||page==="recipes"||page==="recipe")refreshDataInBackground(["recipes"]);
    if(page==="todo"){refreshDataInBackground(["todos"]);if(!cacheMeta["todo-options"].loaded)load("todo-options",{background:true})}
    if(page==="events")refreshDataInBackground(["events"]);
    if(page==="plan")refreshDataInBackground(["mealPlan","recipes"]);
  }catch(e){console.error(e);app.innerHTML=errorScreen(e)}
}
if(!window.location.hash)show("home");
