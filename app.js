const API = window.DAILY_LIFE_API || "";
const DEMO = {
  recipes:[
    {id:"demo-thai",name:"Thai green curry",cuisine:"Thai",time:"30 mins",servings:4,difficulty:"Easy",
     description:"A fresh and flavourful Thai classic. Quick enough for a busy weeknight and great with steamed rice.",
     image:"",ingredients:["2 tbsp vegetable oil","1 onion, finely sliced","2 garlic cloves, crushed","1 green chilli, sliced","400ml coconut milk","2 tbsp green curry paste","400g chicken, sliced (or tofu)","1 red pepper, sliced","Handful of basil leaves","Juice of 1 lime"]}
  ],
  todos:[
    {id:"d1",task:"Pick up dry cleaning",due:"Today",category:"Errands",status:"To do"},
    {id:"d2",task:"Shop for the week",due:"Today",category:"Shopping",status:"To do"},
    {id:"d3",task:"Prep ingredients for dinner",due:"Today",category:"Home",status:"To do"},
    {id:"d4",task:"Book dentist appointment",due:"Tomorrow",category:"Personal",status:"To do"},
    {id:"d5",task:"Water the plants",due:"Tomorrow",category:"Home",status:"To do"},
    {id:"d6",task:"Birthday present for Sophie",due:"Upcoming",category:"Family",status:"To do"}
  ],
  week:["Pasta Bolognese","Chicken Stir Fry","Tacos","Fish & Veg"]
};
async function api(path, options={}) {
  if(!API) return null;
  try { const r=await fetch(API.replace(/\/$/,"")+path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}}); if(!r.ok) throw Error(); return await r.json(); } catch(e){return null}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function imgOrIcon(r){return r.image?`<img class="thumb" src="${esc(r.image)}">`:`<div class="thumb" style="display:grid;place-items:center;font-size:24px">🍲</div>`}
function nav(active){return `<nav class="bottom"><button class="nav ${active==="home"?"active":""}" onclick="show('home')"><span class="ni">⌂</span>Home</button><button class="nav ${active==="recipes"?"active":""}" onclick="show('recipes')"><span class="ni">♨</span>Recipes</button><button class="nav ${active==="todo"?"active":""}" onclick="show('todo')"><span class="ni">✓</span>Lists</button><button class="nav"><span class="ni">•••</span>More</button></nav>`}
function header(title,back=false){return `<header class="header">${back?`<button class="back" onclick="show('home')">‹</button>`:`<div class="logo">Daily Life</div>`}<h1 class="screen-title">${back?esc(title):""}</h1><button class="avatar">♙</button></header>`}
async function getData(){
 const [rs,ts,ms]=await Promise.all([api("/api/recipes"),api("/api/todos"),api("/api/meal-plan")]);
 return {recipes:rs?.recipes||DEMO.recipes,todos:ts?.todos||DEMO.todos,week:ms?.week||DEMO.week};
}
async function home(){
 const d=await getData(), r=d.recipes[0], remaining=d.todos.filter(x=>x.status!=="Done").length;
 return `<div class="shell">${header()}<main class="page"><div class="eyebrow">Good morning,</div><div class="hello">The Wilsons ☀️</div>
 <div class="modules"><button class="module m-meal" onclick="show('recipes')"><div class="ico">♜</div><span>Meal plan</span></button><button class="module m-todo" onclick="show('todo')"><div class="ico">✓</div><span>To do</span></button><button class="module m-shop"><div class="ico">🛒</div><span>Shopping</span></button><button class="module m-family"><div class="ico">♧</div><span>Family</span></button></div>
 <div class="section-head"><h2>Today</h2><span class="eyebrow">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}</span></div>
 <div class="card row" onclick="show('recipe', '${esc(r.id)}')">${imgOrIcon(r)}<div class="grow"><div class="eyebrow">Dinner</div><div class="title">${esc(r.name)}</div></div><div class="chev">›</div></div>
 ${d.todos.slice(0,3).map(t=>`<div class="card row" onclick="show('todo')"><button class="check ${t.status==="Done"?"done":""}" onclick="event.stopPropagation();toggleTodo('${t.id}')">${t.status==="Done"?"✓":""}</button><div class="grow"><div class="title">${esc(t.task)}</div><div class="sub">${esc(t.due)}</div></div><div class="chev">›</div></div>`).join("")}
 <div class="section-head"><h2>This week's meal plan</h2><button class="link" onclick="show('recipes')">View all</button></div>
 <div class="meal-week">${d.week.map((x,i)=>`<div class="day d${(i%4)+1}"><small>${["Mon","Tue","Wed","Thu"][i]}</small><b>${esc(x)}</b></div>`).join("")}</div></main>${nav("home")}</div>`
}
async function recipes(){
 const d=await getData(); return `<div class="shell">${header("Recipes",true)}<main class="page"><div class="filterbar"><span class="pill active">All</span><span class="pill">Quick</span><span class="pill">Family</span><span class="pill">Favourites</span></div>${d.recipes.map(r=>`<div class="card row" onclick="show('recipe','${r.id}')">${imgOrIcon(r)}<div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${esc(r.cuisine||"")} · ${esc(r.time||"")} ${r.servings?`· ${r.servings} servings`:""}</div></div><div class="chev">›</div></div>`).join("")||'<div class="empty">No recipes yet.</div>'}</main>${nav("recipes")}</div>`
}
async function recipe(id){
 const d=await getData(); let r=d.recipes.find(x=>x.id===id)||d.recipes[0];
 if(API){const full=await api("/api/recipes/"+encodeURIComponent(id)); if(full?.recipe) r=full.recipe}
 return `<div class="shell">${header(r.name,true)}<main class="page"><article class="hero">${r.image?`<img class="hero-img" src="${esc(r.image)}">`:`<div class="hero-img" style="display:grid;place-items:center;font-size:70px">🍲</div>`}<div class="recipe-body"><h1>${esc(r.name)}</h1><div class="meta"><span>◷ ${esc(r.time||"30 mins")}</span><span>♜ ${r.servings||4} servings</span><span>♧ ${esc(r.difficulty||"Easy")}</span></div><p class="desc">${esc(r.description||"A family favourite from your recipe collection.")}</p><h3>Ingredients</h3>${(r.ingredients||[]).map(i=>`<div class="ingredient"><span class="circle"></span>${esc(i)}</div>`).join("")}<button class="module m-meal" style="width:100%;margin-top:14px;padding:14px" onclick="toast('Added to meal plan')">▣ &nbsp; Add to meal plan</button></div></article></main></div>`
}
async function todo(){
 const d=await getData(); const groups=["Today","Tomorrow","Upcoming"];
 const sections=groups.map(g=>{
   const ts=d.todos.filter(t=>t.due===g);
   if(!ts.length)return "";
   const items=ts.map(t=>`<div class="card row"><button class="check ${t.status==="Done"?"done":""}" onclick="toggleTodo(\'${t.id}\')">${t.status==="Done"?"✓":""}</button><div class="grow"><div class="title">${esc(t.task)}</div><span class="tag ${esc(t.category)}">${esc(t.category)}</span></div><div class="chev">›</div></div>`).join("");
   return `<div class="todo-group"><b>${g}</b><span>${ts.filter(t=>t.status!=="Done").length} remaining</span></div>${items}`;
 }).join("");
 return `<div class="shell">${header("To do",false)}<main class="page"><div style="display:flex;justify-content:space-between;align-items:center"><h1 class="screen-title">To do</h1><button class="plus" onclick="toast(\'Add task coming next\')">+</button></div><div class="filterbar"><span class="pill active">All</span><span class="pill">Today</span><span class="pill">Upcoming</span><span class="pill">Done</span></div>${sections}</main>${nav("todo")}</div>`
}
async function toggleTodo(id){if(id.startsWith("d")){DEMO.todos=DEMO.todos.map(t=>t.id===id?{...t,status:t.status==="Done"?"To do":"Done"}:t);render("todo");return} await api("/api/todos/"+id,{method:"PATCH",body:JSON.stringify({status:"Done"})});render("todo")}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),1800)}
async function show(page,id){window.scrollTo(0,0);document.getElementById("app").innerHTML='<div class="shell loading">Loading…</div>';let html=page==="home"?await home():page==="recipes"?await recipes():page==="recipe"?await recipe(id):await todo();document.getElementById("app").innerHTML=html}
async function render(p="home"){await show(p)}
render();
