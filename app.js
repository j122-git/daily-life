/* Daily Life frontend — Cloudflare Worker + Airtable */
const API=(window.DAILY_LIFE_API||"https://daily-life.thibaud-guerrero.workers.dev/").replace(/\/$/,"");
let APP_TOKEN=localStorage.getItem("dailyLifeAppToken")||"";
let state={recipes:[],todos:[],mealPlan:[],todoFilter:"all"};

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
function dateLabel(s){if(!s)return "";const d=new Date(s+"T00:00:00");return isNaN(d)?s:d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
function bucket(t){if(t.bucket)return t.bucket;if(t.due===today())return"today";if(t.due===tomorrow())return"tomorrow";return"upcoming"}
function img(r,cls="thumb"){return r.image?`<img class="${cls}" src="${esc(r.image)}" alt="" loading="lazy">`:`<div class="${cls}" style="display:grid;place-items:center;font-size:24px">🍲</div>`}
function nav(a){return `<nav class="bottom"><button class="nav ${a==="home"?"active":""}" onclick="show('home')"><span class="ni">⌂</span>Home</button><button class="nav ${a==="recipes"?"active":""}" onclick="show('recipes')"><span class="ni">♨</span>Recipes</button><button class="nav ${a==="todo"?"active":""}" onclick="show('todo')"><span class="ni">✓</span>Lists</button><button class="nav" onclick="toast('More coming soon')"><span class="ni">•••</span>More</button></nav>`}
function header(title="",back=false){return `<header class="header">${back?`<button class="back" onclick="show('home')">‹</button>`:`<div class="logo">Daily Life</div>`}<h1 class="screen-title">${back?esc(title):""}</h1><button class="avatar" onclick="show('token')" aria-label="Connection settings" title="Connection settings">🔑</button></header>`}
async function load(kind){const d=await api(kind==="recipes"?"/api/recipes":kind==="todos"?"/api/todos":"/api/meal-plan");if(kind==="recipes")state.recipes=d.recipes||[];if(kind==="todos")state.todos=(d.todos||[]).map(t=>({...t,bucket:bucket(t)}));if(kind==="mealPlan")state.mealPlan=d.mealPlan||[];return d}
async function all(){await Promise.all([load("recipes"),load("todos"),load("mealPlan")]);return state}
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

async function home(){await all();const meal=state.mealPlan.find(m=>m.date===today()),r=recipeFor(meal)||state.recipes[0],ts=state.todos.filter(t=>t.bucket==="today"&&t.status!=="Done").slice(0,3);return `<div class="shell">${header()}<main class="page"><div class="eyebrow">Good morning,</div><div class="hello">The Wilsons ☀️</div><div class="modules"><button class="module m-meal" onclick="show('recipes')"><div class="ico">♜</div><span>Meal plan</span></button><button class="module m-todo" onclick="show('todo')"><div class="ico">✓</div><span>To do (${state.todos.filter(t=>t.status!=="Done").length})</span></button><button class="module m-shop" onclick="toast('Shopping list coming next')"><div class="ico">🛒</div><span>Shopping</span></button><button class="module m-family" onclick="toast('Family coming next')"><div class="ico">♧</div><span>Family</span></button></div><div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>${r?`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="eyebrow">${esc(meal?.meal||"Meal")}</div><div class="title">${esc(r.name)}</div></div><div class="chev">›</div></div>`:`<div class="card" style="padding:18px"><div class="sub">Nothing planned for today.</div></div>`}${ts.map(t=>`<div class="card row" onclick="show('todo')"><button class="check" onclick="event.stopPropagation();toggleTodo('${esc(t.id)}')"></button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.category||"")}</div></div><div class="chev">›</div></div>`).join("")}<div class="section-head"><h2>This week's meal plan</h2><button class="link" onclick="show('recipes')">View all</button></div><div class="meal-week">${week()}</div></main>${nav("home")}</div>`}
async function recipes(){await load("recipes");return `<div class="shell">${header("Recipes",true)}<main class="page"><div class="filterbar"><span class="pill active">All</span><span class="pill">Quick</span><span class="pill">Family</span><span class="pill">Favourites</span></div>${state.recipes.map(r=>`<div class="card row" onclick="show('recipe','${esc(r.id)}')">${img(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${esc(r.cuisine||"")}${r.cookingTime?` · ${esc(r.cookingTime)}`:""}${r.servings?` · ${esc(r.servings)} servings`:""}</div></div><div class="chev">›</div></div>`).join("")||'<div class="empty">No recipes found.</div>'}</main>${nav("recipes")}</div>`}
async function recipe(id){const d=await api(`/api/recipes/${encodeURIComponent(id)}`),r=d.recipe;if(!r)throw Error("Recipe not found");const ing=Array.isArray(r.ingredients)?r.ingredients:[];return `<div class="shell">${header(r.name,true)}<main class="page"><article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}" alt="">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px">🍲</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta">${r.cookingTime?`<span>◷ ${esc(r.cookingTime)}</span>`:""}${r.servings?`<span>♜ ${esc(r.servings)} servings</span>`:""}${r.difficulty?`<span>♧ ${esc(r.difficulty)}</span>`:""}</div>${r.notes||r.recipeText?`<p class="desc">${esc(r.notes||r.recipeText)}</p>`:""}${ing.length?`<h3>Ingredients</h3>${ing.map(x=>`<div class="ingredient"><span class="circle"></span>${esc(typeof x==="string"?x:JSON.stringify(x))}</div>`).join("")}`:""}<button class="module m-meal" style="width:100%;margin-top:14px;padding:14px" onclick="toast('Meal-plan editing coming next')">▣ &nbsp; Add to meal plan</button></div></article></main></div>`}
function todoFilterItems(){
  const f=state.todoFilter;
  if(f==="today") return state.todos.filter(t=>t.bucket==="today"&&t.status!=="Done");
  if(f==="upcoming") return state.todos.filter(t=>(t.bucket==="tomorrow"||t.bucket==="upcoming")&&t.status!=="Done");
  if(f==="done") return state.todos.filter(t=>t.status==="Done");
  return state.todos;
}

function todoFilterButton(label,value){
  return `<button class="pill ${state.todoFilter===value?"active":""}" onclick="setTodoFilter('${value}')">${label}</button>`;
}

function todoForm(mode="add",id=""){
  const t=id?state.todos.find(x=>x.id===id):null;
  const title=mode==="edit"?"Edit task":"Add a task";
  const action=mode==="edit"?`saveTodo('${esc(id)}')`:`saveTodo()`;
  const due=t?.due||today();
  const category=t?.category||"Home";
  return `<div class="modal-backdrop" id="todo-modal" role="presentation" onclick="if(event.target===this)closeTodoForm()">
    <div class="modal todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-modal-title">
      <div class="modal-head"><div><div class="eyebrow">To do</div><h2 id="todo-modal-title">${title}</h2></div><button class="modal-close" onclick="closeTodoForm()" aria-label="Close">×</button></div>
      <label class="form-label" for="todo-task">Task</label>
      <input class="form-input" id="todo-task" type="text" maxlength="200" value="${esc(t?.task||"")}" placeholder="e.g. Buy nappies">
      <label class="form-label" for="todo-due">Due date</label>
      <input class="form-input" id="todo-due" type="date" value="${esc(due)}">
      <label class="form-label" for="todo-category">Category</label>
      <select class="form-input form-select" id="todo-category">
        ${["Home","Shopping","Errands","Personal","Family"].map(c=>`<option value="${c}" ${category===c?"selected":""}>${c}</option>`).join("")}
      </select>
      <button class="primary-button" onclick="${action}">${mode==="edit"?"Save changes":"Add task"}</button>
      ${mode==="edit"?`<button class="danger-button" onclick="closeTodoForm();deleteTodo('${esc(id)}')">Delete task</button>`:""}
    </div>
  </div>`;
}

function openTodoForm(mode="add",id=""){
  document.body.insertAdjacentHTML("beforeend",todoForm(mode,id));
  setTimeout(()=>document.getElementById("todo-task")?.focus(),0);
}
function closeTodoForm(){document.getElementById("todo-modal")?.remove()}
function setTodoFilter(filter){state.todoFilter=filter;show("todo")}

async function saveTodo(id=""){
  const task=document.getElementById("todo-task")?.value.trim()||"";
  const due=document.getElementById("todo-due")?.value||null;
  const category=document.getElementById("todo-category")?.value||"Home";
  if(!task){toast("Please enter a task");document.getElementById("todo-task")?.focus();return}
  const button=document.querySelector("#todo-modal .primary-button");
  if(button){button.disabled=true;button.textContent=id?"Saving…":"Adding…"}
  try{
    const payload={task,due,category};
    if(id){
      await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(payload)});
      toast("Task updated");
    }else{
      await api("/api/todos",{method:"POST",body:JSON.stringify({...payload,status:"To do"})});
      toast("Task added");
    }
    closeTodoForm();
    await show("todo");
  }catch(e){
    toast(`Couldn't ${id?"update":"add"} task: ${e.message}`);
    if(button){button.disabled=false;button.textContent=id?"Save changes":"Add task"}
  }
}

async function todo(){
  await load("todos");
  const filtered=todoFilterItems();
  const groups=state.todoFilter==="done"?["done"]:[["today","Today"],["tomorrow","Tomorrow"],["upcoming","Upcoming"]].map(x=>x);
  let sections="";
  if(state.todoFilter==="done"){
    if(filtered.length) {
      sections += `<div class="todo-group"><b>Done</b><span>${filtered.length} completed</span></div>`;
      for(const t of filtered) sections += todoRow(t);
    }
  }else{
    for(const [b,label] of groups){
      const ts=filtered.filter(t=>t.bucket===b);
      if(!ts.length) continue;
      sections += `<div class="todo-group"><b>${label}</b><span>${ts.length} remaining</span></div>`;
      for(const t of ts) sections += todoRow(t);
    }
  }
  return `<div class="shell">${header("To do",false)}<main class="page"><div class="todo-title-row"><h1 class="screen-title">To do</h1><button class="plus" onclick="openTodoForm()" aria-label="Add task">+</button></div><div class="filterbar" role="tablist">${todoFilterButton("All","all")}${todoFilterButton("Today","today")}${todoFilterButton("Upcoming","upcoming")}${todoFilterButton("Done","done")}</div>${sections||'<div class="empty">No tasks here yet.</div>'}</main>${nav("todo")}</div>`;
}

function todoRow(t){
  const tag=t.category?'<span class="tag '+esc(t.category)+'">'+esc(t.category)+'</span>':'';
  const due=t.due?'<div class="sub">'+dateLabel(t.due)+'</div>':'';
  return '<div class="card row todo-row">'+
    '<button aria-label="Mark task '+esc(t.status==="Done"?"not done":"done")+'" class="check '+(t.status==="Done"?"done":"")+'" onclick="toggleTodo(\''+esc(t.id)+'\')"></button>'+ 
    '<div class="grow" onclick="openTodoForm(\'edit\',\''+esc(t.id)+'\')" style="cursor:pointer">'+
    '<div class="title '+(t.status==="Done"?"completed":"")+'">'+esc(t.task)+'</div>'+tag+due+'</div>'+ 
    '<button class="chev" onclick="openTodoForm(\'edit\',\''+esc(t.id)+'\')" aria-label="Edit task">›</button></div>';
}

async function toggleTodo(id){const t=state.todos.find(x=>x.id===id);if(!t)return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status:t.status==="Done"?"To do":"Done"})});await show("todo")}catch(e){toast("Couldn't update task: "+e.message)}}
async function deleteTodo(id){if(!confirm("Delete this task?"))return;try{await api(`/api/todos/${encodeURIComponent(id)}`,{method:"DELETE"});toast("Task deleted");await show("todo")}catch(e){toast("Couldn't delete task: "+e.message)}}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
function errorScreen(e){return `<div class="shell">${header()}<main class="page"><div class="card" style="padding:20px"><div class="eyebrow">Connection problem</div><h2>Daily Life couldn't reach the Worker.</h2><p class="sub">${esc(e?.message||"Unknown error")}</p><p class="sub">Check DAILY_LIFE_API and DAILY_LIFE_APP_TOKEN in app.js.</p><button class="module m-meal" style="width:100%;margin-top:14px;padding:14px" onclick="show('home')">Try again</button></div></main>${nav("home")}</div>`}
async function show(page,id){
  scrollTo(0,0);
  document.getElementById("app").innerHTML='<div class="shell loading">Loading…</div>';
  try{
    let h;
    if(page==="token") h=tokenScreen();
    else if(page==="home") h=hasAppToken()?await home():tokenScreen();
    else if(page==="recipes") h=await recipes();
    else if(page==="recipe") h=await recipe(id);
    else h=await todo();
    document.getElementById("app").innerHTML=h;
  }catch(e){
    console.error(e);
    document.getElementById("app").innerHTML=errorScreen(e);
  }
}
show("home");
