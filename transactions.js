/* Horst Budget Transactions — mobile-first, private one-card review. */
(function(){
"use strict";
const root=document.getElementById("txRoot");
if(!root)return;
const palette=["#6ca9a0","#e8a28c","#92a0e8","#e7bc74","#b5a1df","#7ebc8a","#df9eb1","#7fadc7"];
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(n)||0);
const safe=x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const enc=x=>encodeURIComponent(String(x||""));
const dateLabel=s=>{const p=String(s||"").split("-");if(p.length!==3)return safe(s);return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});};
const fmtPct=n=>Number.isFinite(n)?(n>=0?"+":"")+n.toFixed(0)+"%":"—";
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");};
const categoryName=x=>String(x||"").trim();
const key=x=>categoryName(x).toLocaleLowerCase();
const isValidColor=c=>/^#[0-9a-f]{6}$/i.test(c||"");
let client=null,user=null,rows=[],rules=[],categories=[],loaded=false,loading=false;
let filter={mode:"all",month:today(),year:String(new Date().getFullYear()),start:"",end:""};
let draftFilter={...filter};
let filtersOpen=false,historyOpen=false,historySearch="",editHistoryId=null,editingCategoryId=null;
let skipped=new Set(),choice={id:null,category:"",subcategory:"",kind:"expense",personTag:""},activeCategoryDrill=null;
let recurring=[],undoStack=[],revisitId=null,actionBusy=false;
let drag=null,openPromise=null,noticeText="",noticeBad=false;
function notice(message,bad=false){noticeText=message||"";noticeBad=bad;const el=root.querySelector("#txNotice");if(el){el.textContent=noticeText;el.classList.toggle("error",bad);}const catEl=document.getElementById("txCatNotice");if(catEl){catEl.textContent=noticeText;catEl.classList.toggle("error",bad);}}
function colorFor(name){const saved=categories.find(c=>key(c.name)===key(name));return saved&&isValidColor(saved.color)?saved.color:palette[Math.abs([...String(name)].reduce((a,c)=>a+c.charCodeAt(0),0))%palette.length];}
function availableCategories(){return categories.filter(c=>!c.archived).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));}
function activeRange(){
 if(filter.mode==="all")return [null,null];
 if(filter.mode==="month"){const [y,m]=filter.month.split("-").map(Number);if(!y||!m||m<1||m>12)return [null,null];return [filter.month+"-01",new Date(y,m,0).toISOString().slice(0,10)];}
 if(filter.mode==="year")return [filter.year+"-01-01",filter.year+"-12-31"];
 if(filter.mode==="range")return [filter.start||null,filter.end||null];
 return [null,null];
}
function dateScope(){
 const [start,end]=activeRange();
 return rows.filter(t=>!start||t.txn_date>=start).filter(t=>!end||t.txn_date<=end);
}
function periodLabel(){
 if(filter.mode==="all")return "All imported dates";
 if(filter.mode==="month"){const [y,m]=filter.month.split("-").map(Number);return new Date(y,m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"});}
 if(filter.mode==="year")return filter.year;
 return [filter.start||"Any date",filter.end||"Today"].join(" – ");
}
function spend(t){
 if(t.pending||t.exclude_from_spending||["transfer","income"].includes(t.kind))return 0;
 if(t.kind==="refund")return -Math.abs(Number(t.amount)||0);
 return Math.abs(Number(t.amount)||0);
}
function summary(list){
 const byCat={},bySub={},byPerson={};
 let total=0;
 for(const t of list){
   const value=spend(t);if(!value)continue;
   total+=value;
   const cat=t.category||"Needs review",sub=t.subcategory||"Other";
   byCat[cat]=(byCat[cat]||0)+value;
   if(t.person_tag){const who=t.person_tag.trim();if(who)byPerson[who]=(byPerson[who]||0)+value;}
   const k=cat+"\u0001"+sub;bySub[k]=(bySub[k]||0)+value;
 }
 return {total,byCat,bySub,byPerson};
}
function upcomingSubscriptions(){
 const now=new Date(),todayLocal=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const end=new Date(todayLocal);end.setDate(end.getDate()+7);
 const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
 const start=iso(todayLocal),finish=iso(end);
 return recurring.filter(t=>t.active&&!t.hidden&&t.recurring_type==="SUBSCRIPTION"&&
  t.predicted_next_date>=start&&t.predicted_next_date<=finish)
  .sort((a,b)=>a.predicted_next_date.localeCompare(b.predicted_next_date)||a.merchant.localeCompare(b.merchant));
}
function trackedPeople(){
 const names=new Map();
 for(const t of rows){const v=String(t.person_tag||"").trim();if(v&&!names.has(key(v)))names.set(key(v),v);}
 return [...names.values()].sort((a,b)=>a.localeCompare(b));
}
function personChoices(){
 return trackedPeople().map(name=>'<button class="tx-choice'+(key(choice.personTag)===key(name)?" selected":"")+
 '" type="button" data-choice-person="'+enc(name)+'">'+safe(name)+'</button>').join("");
}
function renderRecurringBills(){
 const target=document.getElementById("detectedRecurringList");
 const badge=document.getElementById("billRecurringCount");
 if(!target)return;
 const items=recurring.filter(r=>r.active&&!r.hidden&&
  ["SUBSCRIPTION","BILL","MORTGAGE"].includes(r.recurring_type))
  .sort((a,b)=>(a.predicted_next_date||"9999").localeCompare(b.predicted_next_date||"9999"));
 if(badge)badge.textContent=items.length?"("+items.length+")":"";
 if(!loaded){target.innerHTML='<p class="tx-muted">Loading recurring patterns…</p>';return;}
 if(!items.length){target.innerHTML='<p class="tx-muted">No recognized recurring bills or subscriptions yet.</p>';return;}
 target.innerHTML=items.map(r=>{
  const value=Number(r.typical_amount||r.last_amount||0);
  const date=r.predicted_next_date?dateLabel(r.predicted_next_date):"Date unknown";
  return '<div class="tx-detected-item"><div><strong>'+safe(r.description||r.merchant)+'</strong>'+
   '<small>'+safe(r.recurring_type==="SUBSCRIPTION"?"Subscription":r.recurring_type==="MORTGAGE"?"Mortgage":"Bill")+
   ' · '+safe(r.frequency||"Recurring")+' · Expected '+safe(date)+'</small></div>'+
   '<strong>'+(value>0?'≈'+money(value):'Varies')+'</strong></div>';
 }).join("");
}
function getOverview(){
 const current=today();
 const monthRows=rows.filter(t=>t.txn_date&&t.txn_date.startsWith(current));
 const sum=summary(monthRows);
 const ranked=Object.entries(sum.byCat).sort((a,b)=>b[1]-a[1]);
 return {loaded,imported:rows.length,spending:sum.total,topCategories:ranked.slice(0,3),
  toReview:rows.filter(t=>t.review_status!=="auto").length,monthRows:monthRows.length,
  upcomingSubscriptions:upcomingSubscriptions(),recurringCount:recurring.length};
}
function filteredReview(){
 return dateScope().filter(t=>t.review_status!=="auto").sort((a,b)=>b.txn_date.localeCompare(a.txn_date)||b.imported_at.localeCompare(a.imported_at));
}
function selectedReview(){
 const all=filteredReview();
 return all.find(t=>t.id===revisitId&&!skipped.has(t.id))||all.find(t=>!skipped.has(t.id))||null;
}
function takeChoice(tx){
 if(choice.id!==tx.id){
   choice={id:tx.id,category:tx.category||"",subcategory:tx.subcategory||"",kind:tx.kind||"expense",personTag:tx.person_tag||""};
 }
}
function renderFilters(){
 const box=root.querySelector("#txFilters");
 if(!box)return;
 box.hidden=!filtersOpen;
 box.innerHTML='<div class="tx-filter-top"><strong>Choose a time period</strong><button class="tx-quiet" type="button" id="txCloseFilters" aria-label="Close filters">✕</button></div>'+
 '<div class="tx-presets">'+
 [['all',"All dates"],["this-month","This month"],["last-month","Last month"],["this-year","This year"]].map(([mode,label])=>
 '<button type="button" class="tx-mini-chip" data-period="'+mode+'">'+label+'</button>').join("")+'</div>'+
 '<div class="tx-filter-inputs">'+
 '<label>Month<input class="text-input" id="txFilterMonth" type="month" value="'+safe(draftFilter.month)+'"></label>'+
 '<label>Year<input class="text-input" id="txFilterYear" type="number" min="2000" max="2100" inputmode="numeric" value="'+safe(draftFilter.year)+'"></label>'+
 '</div><div class="tx-filter-shortcuts"><button type="button" data-apply-time="month" class="tx-mini-chip">Use month</button><button type="button" data-apply-time="year" class="tx-mini-chip">Use year</button></div>'+
 '<div class="tx-filter-inputs">'+
 '<label>From<input class="text-input" id="txFilterStart" type="date" value="'+safe(draftFilter.start)+'"></label>'+
 '<label>To<input class="text-input" id="txFilterEnd" type="date" value="'+safe(draftFilter.end)+'"></label></div>'+
 '<button type="button" data-apply-time="range" class="tx-mini-chip">Apply date range</button>'+
 '<p class="tx-muted">Your selection updates the review cards, spending charts, and transaction history together.</p>';
}
function categoryChips(){
 const ordered=availableCategories();
 return ordered.map(c=>
 '<button class="tx-choice '+(key(choice.category)===key(c.name)?"selected":"")+
 '" type="button" data-choice-category="'+enc(c.name)+'" style="--chip-color:'+c.color+'">'+safe(c.name)+'</button>').join("");
}
function subcategoryChips(){
 const cat=categories.find(c=>key(c.name)===key(choice.category));
 const subs=cat?cat.subcategories||[]:[];
 if(!subs.length)return '<p class="tx-muted">Optional. Make your own subcategory below.</p>';
 return subs.map(name=>
 '<button type="button" class="tx-choice tx-subchoice '+(key(choice.subcategory)===key(name)?"selected":"")+
 '" data-choice-sub="'+enc(name)+'">'+safe(name)+'</button>').join("");
}
function kindChips(){
 return ["expense","transfer","income","refund"].map(k=>
 '<button class="tx-kind'+(choice.kind===k?" selected":"")+'" data-choice-kind="'+k+'" type="button">'+
 ({expense:"Purchase",transfer:"Transfer",income:"Income",refund:"Refund"}[k])+'</button>').join("");
}
function undoMarkup(){
 if(!undoStack.length)return "";
 return '<button class="tx-undo" type="button" id="txUndoAction" aria-label="Undo last transaction action"><span aria-hidden="true">↶</span> Undo / Back</button>';
}
function reviewerHtml(){
 const all=filteredReview(),pending=all.filter(t=>!skipped.has(t.id)),tx=selectedReview();
 const done=all.length-pending.length;
 const number=rows.filter(t=>t.review_status==="auto"&&dateScope().some(s=>s.id===t.id)).length;
 const progress=all.length+number?Math.round((number/(all.length+number))*100):100;
 if(!tx)return '<section class="tx-review-area"><div class="tx-section-heading"><div><p class="tx-kicker">YOUR DAILY CHECK-IN</p><h2>Review transactions!</h2></div></div>'+
 '<div class="tx-review-undo-row">'+undoMarkup()+'</div>'+
 '<div class="tx-finish"><span class="tx-celebrate">✦</span><h3>All caught up for now.</h3>'+
 '<p>'+(all.length&&skipped.size?"You skipped a few. They are still waiting for you.":"Nothing needs your input for this period.")+'</p>'+
 (all.length&&skipped.size?'<button class="tx-link-button" type="button" id="txReviewSkipped">Review skipped cards</button>':"")+
 '</div></section>';
 takeChoice(tx);
 const stableMerchant=!/^(deposit|bill payment|point of sale|withdrawal|transfer|adjustment)$/i.test(tx.merchant||"");
 return '<section class="tx-review-area"><div class="tx-section-heading"><div><p class="tx-kicker">YOUR DAILY CHECK-IN</p><h2>Review transactions!</h2></div>'+
 '<div class="tx-review-controls">'+undoMarkup()+'<span class="tx-review-count">'+pending.length+' left</span></div></div>'+
 '<div class="tx-progress" role="progressbar" aria-label="Reviewed transactions" aria-valuenow="'+progress+'" aria-valuemin="0" aria-valuemax="100"><span style="width:'+progress+'%"></span></div>'+
 '<div class="tx-card-stack"><article class="tx-swipe-card" id="txSwipeCard" data-tx-id="'+safe(tx.id)+'">'+
 '<div class="tx-card-top"><div class="tx-merchant-avatar">'+safe((tx.merchant||"?").slice(0,1).toUpperCase())+'</div>'+
 '<span class="tx-card-counter">'+(all.length-pending.length+1)+' / '+all.length+'</span></div>'+
 '<div class="tx-merchant">'+safe(tx.merchant)+'</div>'+
 '<div class="tx-card-amount">'+(Number(tx.amount)<0?"−":Number(tx.amount)>0?"+":"")+money(Math.abs(Number(tx.amount)))+'</div>'+
 '<div class="tx-card-meta">'+safe(dateLabel(tx.txn_date))+' · '+safe(tx.account_name||"Connected account")+'</div>'+
 '<div class="tx-guess"><span>✧</span> '+(tx.suggested_category?
 '<span>Possible category: <strong>'+safe(String(tx.suggested_category).replaceAll("_"," "))+'</strong> — your choice</span>':
 '<span>No confident suggestion yet. Your call!</span>')+'</div>'+
 '<div class="tx-choice-block"><label>Category</label><div class="tx-chip-group" id="txCategoryChips">'+categoryChips()+'</div>'+
 '<input class="tx-clean-input" id="txReviewCategory" name="category" aria-label="Your category" maxlength="80" value="'+safe(choice.category)+'" placeholder="Or type your own category"></div>'+
 '<div class="tx-choice-block"><label>Subcategory <span class="tx-optional">optional</span></label><div class="tx-chip-group" id="txSubcategoryChips">'+subcategoryChips()+'</div>'+
 '<input class="tx-clean-input" id="txReviewSubcategory" name="subcategory" maxlength="80" value="'+safe(choice.subcategory)+'" placeholder="Or add your own subcategory"></div>'+
 '<details class="tx-person-details"'+(choice.personTag?' open':'')+'><summary>Who was it for? <span>'+(choice.personTag?safe(choice.personTag):'Optional')+'</span></summary>'+
 '<div class="tx-person-panel">'+(trackedPeople().length?'<div class="tx-chip-group">'+personChoices()+'</div>':'')+
 '<input class="tx-clean-input" id="txReviewPerson" name="person" maxlength="80" autocomplete="off" placeholder="Assign to a person (optional)" value="'+safe(choice.personTag)+'">'+
 '<p class="tx-muted">This tracks spending by person, separate from the category.</p></div></details>'+
 '<details class="tx-kind-details"><summary>What kind of transaction? <span>'+safe(choice.kind)+'</span></summary><div class="tx-kind-group">'+kindChips()+'</div></details>'+
 (stableMerchant?'<label class="tx-remember"><input type="checkbox" id="txRememberMerchant"> Remember this merchant for future charges</label>':
 '<p class="tx-muted">Generic payment names are never saved as automatic merchant rules.</p>')+
 '<div class="tx-swipe-actions"><button type="button" class="tx-skip" id="txSkipCard">Skip</button>'+
 '<button type="button" class="tx-save" id="txSaveCard">Save &amp; next <span>→</span></button></div>'+
 '<div class="tx-swipe-hint">Swipe right to save · swipe left to skip</div></article></div></section>';
}
function renderInsights(){
 const data=dateScope(),sum=summary(data),ranked=Object.entries(sum.byCat).sort((a,b)=>b[1]-a[1]);
 const parts=ranked.filter(x=>x[1]>0).slice(0,6);
 const positive=parts.reduce((n,x)=>n+x[1],0);
 let angle=0,stops=[];
 for(const [name,value] of parts){const portion=positive?100*value/positive:0;
 const next=angle+portion;stops.push(colorFor(name)+" "+angle.toFixed(2)+"% "+next.toFixed(2)+"%");angle=next;}
 if(angle<100)stops.push("var(--surface-sunk) "+angle.toFixed(2)+"% 100%");
 const donut=stops.length?"conic-gradient("+stops.join(",")+")":"conic-gradient(var(--surface-sunk) 0% 100%)";
 const top=ranked.slice(0,5);
 const metric=money(sum.total);
 let note="Based on "+data.length+" imported transactions. Transfers excluded.";
 if(rows.length&&data.length===0)note="No imported transactions in this time period.";
 const catHtml=top.length?top.map(([name,val])=>{
  const portion=Math.max(0,Math.min(100,sum.total>0?val/sum.total*100:0));
  const subs=Object.entries(sum.bySub).filter(([k])=>k.startsWith(name+"\u0001")).sort((a,b)=>b[1]-a[1]);
  const drill=activeCategoryDrill===name;
  return '<div class="tx-bar-card" data-category-row="'+enc(name)+'"><button type="button" class="tx-bar-head" data-cat-drill="'+enc(name)+'">'+
   '<span class="tx-bar-name"><i style="background:'+colorFor(name)+'"></i>'+safe(name)+'</span><strong>'+money(val)+'</strong></button>'+
   '<div class="tx-bar-track"><span style="width:'+portion.toFixed(1)+'%;background:'+colorFor(name)+'"></span></div>'+
   (drill?'<div class="tx-sub-breakdown">'+subs.map(([k,amount])=>'<span>'+safe(k.split("\u0001")[1])+': <strong>'+money(amount)+'</strong></span>').join("")+'</div>':'')+
  '</div>';
 }).join(""):'<div class="tx-empty-spend">Your spending breakdown will appear as transactions are imported and reviewed.</div>';
 return '<section class="tx-insights"><div class="tx-section-heading"><div><p class="tx-kicker">THE BIG PICTURE</p><h2>Where your money goes</h2></div>'+
 '<span class="tx-period-badge">'+safe(periodLabel())+'</span></div>'+
 '<div class="tx-insights-grid"><div class="tx-spending-hero"><div class="tx-spend-kicker">TOTAL SPENDING</div>'+
 '<div class="tx-spend-amount">'+metric+'</div>'+
 '<p class="tx-muted">'+safe(note)+'</p>'+
 '<div class="tx-donut-wrap"><div class="tx-donut" style="background:'+donut+'">'+
 '<div class="tx-donut-center"><strong>'+top.length+'</strong><span>categories</span></div></div></div></div>'+
 '<div class="tx-spend-breakdown">'+catHtml+'</div></div>'+
 '<div class="tx-people-spend"><h3>Spending by person</h3>'+
 (Object.keys(sum.byPerson).length?Object.entries(sum.byPerson).sort((a,b)=>b[1]-a[1]).map(([person,amount])=>
  '<div class="tx-person-summary"><span>'+safe(person)+'</span><strong>'+money(amount)+'</strong></div>').join(""):
  '<p class="tx-muted">Assign purchases to a person as you review them. Their totals will appear here.</p>')+
 '</div></section>';
}
function historyRows(){
 const scoped=dateScope();
 const q=historySearch.trim().toLowerCase();
 const filtered=q?scoped.filter(t=>[t.merchant,t.account_name,t.category,t.subcategory,t.description,t.person_tag].some(s=>String(s||"").toLowerCase().includes(q))):scoped;
 const sorted=filtered.slice().sort((a,b)=>b.txn_date.localeCompare(a.txn_date));
 if(!sorted.length)return '<p class="tx-muted">No transactions match this filter.</p>';
 return sorted.map(t=>{
 const isEditing=editHistoryId===t.id;
 const label=[t.category||"Not categorized",t.subcategory].filter(Boolean).join(" / ");
 return '<div class="tx-history-row"><div class="tx-history-main"><div><strong>'+safe(t.merchant)+'</strong>'+
 '<small>'+safe(dateLabel(t.txn_date))+' · '+safe(t.account_name||"")+'</small>'+
 '<span class="tx-history-category">'+safe(label)+(t.kind==="transfer"?" · Transfer":"")+'</span>'+(t.person_tag?'<small>Person: '+safe(t.person_tag)+'</small>':'')+'</div>'+
 '<div class="tx-history-right"><strong>'+money(t.amount)+'</strong><button type="button" data-edit-tx="'+safe(t.id)+'">'+(isEditing?"Close":"Edit")+'</button></div></div>'+
 (isEditing?'<form class="tx-history-form" data-edit-form="'+safe(t.id)+'">'+
 '<label>Category<input class="tx-clean-input" name="category" value="'+safe(t.category||"")+'" required maxlength="80"></label>'+
 '<label>Subcategory<input class="tx-clean-input" name="subcategory" value="'+safe(t.subcategory||"")+'" maxlength="80"></label>'+
 '<label>Person<input class="tx-clean-input" name="person" maxlength="80" value="'+safe(t.person_tag||"")+'" placeholder="Optional"></label>'+ 
 '<label>Type<select class="select-input" name="kind">'+["expense","transfer","income","refund"].map(k=>'<option value="'+k+'"'+(t.kind===k?" selected":"")+'>'+k+'</option>').join("")+'</select></label>'+
 '<button class="tx-save" type="submit">Save change</button></form>':"")+'</div>';
 }).join("");
}
function renderHistoryRows(){
 const target=root.querySelector("#txHistoryRows");if(target)target.innerHTML=historyRows();
}
function renderDashboard(){
 const scoped=dateScope();
 root.innerHTML='<div class="tx-app">'+
 '<div class="tx-header"><div><p class="tx-kicker">YOUR MONEY, SIMPLIFIED</p><h1>Transactions</h1><p class="tx-header-sub">A little clarity, every day.</p></div>'+
 '<button class="tx-filter-button" type="button" id="txOpenFilters" aria-expanded="'+String(filtersOpen)+'" aria-controls="txFilters">'+
 '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg> Filter</button></div>'+
 '<div id="txFilters" class="tx-filter-panel" hidden></div>'+
 '<div class="tx-current-scope"><span class="tx-scope-dot"></span>'+safe(periodLabel())+' · '+scoped.length+' transactions</div>'+
 '<div id="txNotice" role="status" aria-live="polite" class="tx-notice'+(noticeBad?" error":"")+'">'+safe(noticeText)+'</div>'+
 (loading?'<div class="tx-loading">Loading your private data…</div>':
 reviewerHtml()+renderInsights()+
 '<details class="tx-history-drawer" id="txHistoryDrawer" '+(historyOpen?"open":"")+'>'+
 '<summary><span><strong>All transactions</strong><small>Browse or correct individual purchases</small></span><span class="tx-history-count">'+scoped.length+' records　⌄</span></summary>'+
 '<div class="tx-history-inner"><input class="tx-clean-input" id="txHistorySearch" type="search" autocomplete="off" placeholder="Search transactions…" value="'+safe(historySearch)+'">'+
 '<div id="txHistoryRows">'+historyRows()+'</div></div></details>')+
 '</div>';
 renderFilters();
}
function render(){
 if(!user){root.innerHTML='<div class="tx-loading">Sign in to view your transactions.</div>';return;}
 renderDashboard();
}
async function loadData(){
 if(!client||!user)return;
 loading=true;render();
 const values=await Promise.all([
  client.from("horst_transactions").select("*").eq("owner_id",user.id).order("txn_date",{ascending:false}).limit(5000),
  client.from("horst_transaction_rules").select("*").eq("owner_id",user.id).limit(1000),
  client.from("horst_budget_categories").select("*").eq("owner_id",user.id).order("position",{ascending:true}),
  client.from("horst_recurring_streams").select("*").eq("owner_id",user.id).limit(500)
 ]);
 loading=false;
 const error=values.find(x=>x.error);
 if(error){notice("Couldn't load private data: "+error.error.message,true);render();return;}
 rows=values[0].data||[];rules=values[1].data||[];categories=values[2].data||[];recurring=values[3].data||[];
 loaded=true;
 noticeText="";noticeBad=false;
 render();
 if(typeof currentView!=="undefined"&&currentView==="home"&&typeof renderHome==="function")renderHome();
 renderRecurringBills();
 const panel=document.getElementById("txCategorySettings");
 if(panel)renderCategorySettings();
}
async function preload(){
 if(openPromise)return openPromise;
 openPromise=(async()=>{
   client=window.horstAuthClient;
   if(!client){openPromise=null;return;}
   const response=await client.auth.getUser();
   user=response.data&&response.data.user||null;
   if(!user){openPromise=null;return;}
   await loadData();
 })().catch(e=>{openPromise=null;notice("Could not initialize Transactions: "+e.message,true);render();});
 return openPromise;
}
function choose(kind,value){
 const tx=selectedReview();if(!tx)return;
 takeChoice(tx);
 if(kind==="category"){choice.category=key(choice.category)===key(value)?"":value;choice.subcategory="";}
 if(kind==="subcategory"){choice.subcategory=key(choice.subcategory)===key(value)?"":value;}
 if(kind==="person"){choice.personTag=key(choice.personTag)===key(value)?"":value;}
 if(kind==="kind"){choice.kind=value;}
 renderDashboard();
}
async function ensureCategory(name,sub){
 name=categoryName(name);sub=categoryName(sub);
 if(!name)return;
 let found=categories.find(c=>key(c.name)===key(name));
 if(found){
  if(sub&&!(found.subcategories||[]).some(s=>key(s)===key(sub))){
   const merged=(found.subcategories||[]).concat(sub);
   const res=await client.from("horst_budget_categories").update({subcategories:merged}).eq("id",found.id).eq("owner_id",user.id);
   if(res.error)throw res.error;
   found.subcategories=merged;
  }
  return;
 }
 const color=palette[categories.length%palette.length];
 const insert=await client.from("horst_budget_categories").insert({
  owner_id:user.id,name,subcategories:sub?[sub]:[],color,position:categories.length+1
 }).select("*").single();
 if(insert.error){
  if(insert.error.code==="23505"){
   const fetch=await client.from("horst_budget_categories").select("*").eq("owner_id",user.id);
   if(!fetch.error){categories=fetch.data||[];return;}
  }
  throw insert.error;
 }
 categories.push(insert.data);
}
async function persist(tx,category,subcategory,kind,remember,personTag){
 personTag=categoryName(personTag===undefined?tx.person_tag:personTag);
 if(personTag.length>80){notice("Person tags must be 80 characters or less.",true);return false;}
 category=categoryName(category);subcategory=categoryName(subcategory);
 if(!category){notice("Choose a category or type your own first.",true);return false;}
 if(category.length>80||subcategory.length>80){notice("Category names must be 80 characters or less.",true);return false;}
 if(!["expense","transfer","income","refund"].includes(kind))kind="expense";
 const update=await client.from("horst_transactions").update({
  category,subcategory:subcategory||null,person_tag:personTag||null,kind,exclude_from_spending:kind==="transfer",
  review_status:"auto",classification_origin:"manual",reviewed_at:new Date().toISOString(),
  updated_at:new Date().toISOString()
 }).eq("id",tx.id).eq("owner_id",user.id).select("id");
 if(update.error)throw update.error;
 if(!update.data?.length)throw new Error("The transaction was not updated. Check your session.");
 await ensureCategory(category,subcategory);
 const stable=!/^(deposit|bill payment|point of sale|withdrawal|transfer|adjustment)$/i.test(tx.merchant||"");
 if(remember&&stable){
  const rule=await client.from("horst_transaction_rules").upsert({
   owner_id:user.id,merchant_match:tx.merchant.trim().toLowerCase(),category,
   subcategory:subcategory||null,kind,exclude_from_spending:kind==="transfer",enabled:true
  },{onConflict:"owner_id,merchant_match"}).select("*").single();
  if(rule.error)throw rule.error;
  const index=rules.findIndex(r=>r.merchant_match===rule.data.merchant_match);
  if(index>=0)rules[index]=rule.data;else rules.push(rule.data);
 }
 const local=rows.find(t=>t.id===tx.id);
 if(local)Object.assign(local,{category,subcategory:subcategory||null,person_tag:personTag||null,kind,
  exclude_from_spending:kind==="transfer",review_status:"auto",classification_origin:"manual",reviewed_at:new Date().toISOString()});
 return true;
}
const txnUndoFields=["category","subcategory","person_tag","kind","exclude_from_spending","review_status",
 "classification_origin","reviewed_at"];
function snapshotTxn(tx){
 const data={};
 for(const field of txnUndoFields)data[field]=tx[field]??null;
 return data;
}
async function saveCurrent(){
 if(actionBusy)return;
 const tx=selectedReview();if(!tx)return;
 const cat=root.querySelector("#txReviewCategory")?.value??choice.category;
 const sub=root.querySelector("#txReviewSubcategory")?.value??choice.subcategory;
 const person=root.querySelector("#txReviewPerson")?.value??choice.personTag;
 const remember=!!root.querySelector("#txRememberMerchant")?.checked;
 const merchantKey=String(tx.merchant||"").trim().toLowerCase();
 const stable=!/^(deposit|bill payment|point of sale|withdrawal|transfer|adjustment)$/i.test(tx.merchant||"");
 const before=snapshotTxn(tx);
 const ruleBefore=remember&&stable?structuredClone(rules.find(r=>r.merchant_match===merchantKey)||null):null;
 const previousChoice={...choice,category:cat,subcategory:sub,personTag:person};
 const btn=root.querySelector("#txSaveCard");if(btn)btn.disabled=true;
 actionBusy=true;
 try{
  const result=await persist(tx,cat,sub,choice.kind,remember,person);
  if(!result){if(btn)btn.disabled=false;return;}
  undoStack.push({type:"save",txId:tx.id,before,previousChoice,merchantKey,
   remembered:remember&&stable,ruleBefore});
  revisitId=null;choice.id=null;notice("Saved. You can always undo the last card.");
  render();
  if(typeof currentView!=="undefined"&&currentView==="home")renderHome();
  if(document.getElementById("txCategorySettings"))renderCategorySettings();
 }catch(error){notice("Could not save: "+error.message,true);if(btn)btn.disabled=false;}
 finally{actionBusy=false;}
}
function skipCurrent(){
 if(actionBusy)return;
 const tx=selectedReview();if(!tx)return;
 undoStack.push({type:"skip",txId:tx.id,previousChoice:{...choice}});
 skipped.add(tx.id);revisitId=null;choice.id=null;notice("");render();
}
async function undoLast(){
 if(actionBusy||!undoStack.length)return;
 const last=undoStack[undoStack.length-1];
 const tx=rows.find(t=>t.id===last.txId);
 if(!tx){notice("Previous transaction not found. Reload the page.",true);return;}
 actionBusy=true;
 try{
  if(last.type==="save"){
   const restore=await client.from("horst_transactions").update({
    ...last.before,updated_at:new Date().toISOString()
   }).eq("owner_id",user.id).eq("id",last.txId).select("id");
   if(restore.error)throw restore.error;
   if(!restore.data?.length)throw new Error("The transaction could not be restored.");
   Object.assign(tx,last.before);
   if(last.remembered){
    let ruleResult;
    if(last.ruleBefore){
     const {id,created_at,...old}=last.ruleBefore;
     ruleResult=await client.from("horst_transaction_rules").upsert(old,{onConflict:"owner_id,merchant_match"});
    }else{
     ruleResult=await client.from("horst_transaction_rules").delete()
      .eq("owner_id",user.id).eq("merchant_match",last.merchantKey);
    }
    if(ruleResult.error)throw new Error("Transaction restored; merchant rule could not be reversed: "+ruleResult.error.message);
    const allRules=await client.from("horst_transaction_rules").select("*").eq("owner_id",user.id);
    if(!allRules.error)rules=allRules.data||[];
   }
  }
  skipped.delete(last.txId);
  undoStack.pop();
  if(!dateScope().some(t=>t.id===last.txId))filter.mode="all";
  revisitId=last.txId;
  choice={...last.previousChoice};
  notice(last.type==="save"?"Last classification undone. Review it again.":"Back to the previous card.");
  render();
  if(typeof currentView!=="undefined"&&currentView==="home")renderHome();
 }catch(error){notice("Undo could not finish: "+error.message,true);}
 finally{actionBusy=false;}
}
function sumBeforeRange(){
 const data=dateScope();
 return data.length;
}
function renderCategorySettings(){
 const node=document.getElementById("txCategorySettings");
 if(!node||!user)return;
 const current=availableCategories();
 node.innerHTML='<div class="tx-settings-heading"><div><h2>Categories & subcategories</h2>'+
 '<p>Make these your own. You are never locked into the suggested categories.</p></div></div>'+
 '<div id="txCatNotice" class="tx-cat-notice'+(noticeBad?" error":"")+'" role="status" aria-live="polite">'+safe(noticeText)+'</div>'+
 '<form id="txNewCategory" class="tx-new-category"><input class="tx-clean-input" type="text" name="name" maxlength="80" required placeholder="New category name"><button class="tx-save" type="submit">Add category</button></form>'+
 '<div class="tx-config-list">'+(current.length?current.map(c=>categoryConfigRow(c)).join(""):'<p class="tx-muted">You have not created any categories yet. Add one above when you need it.</p>')+'</div>'+
 '<p class="tx-muted">Archiving hides a category from new choices but keeps its historical transactions. Renaming updates existing transaction labels.</p>';
}
function categoryConfigRow(c){
 const editing=editingCategoryId===c.id;
 const chips=(c.subcategories||[]).map(s=>'<span class="tx-sub-badge">'+safe(s)+'</span>').join("");
 const header='<div class="tx-config-header"><div><i style="background:'+safe(c.color)+'"></i><strong>'+safe(c.name)+'</strong>'+
 '<div class="tx-config-subs">'+(chips||'<span class="tx-muted">No subcategories yet</span>')+'</div></div>'+
 '<button type="button" class="tx-link-button" data-config-edit="'+safe(c.id)+'">'+(editing?"Close":"Customize")+'</button></div>';
 if(!editing)return '<div class="tx-config-card">'+header+'</div>';
 const editor='<form class="tx-category-editor" data-category-form="'+safe(c.id)+'">'+
 '<label>Category name<input class="tx-clean-input" name="name" type="text" maxlength="80" required value="'+safe(c.name)+'"></label>'+
 '<label>Color<input type="color" name="color" value="'+safe(isValidColor(c.color)?c.color:"#6ca9a0")+'"></label>'+
 '<div class="tx-subeditor"><p class="tx-muted">Rename or remove subcategories</p>'+
 (c.subcategories||[]).map(s=>'<div class="tx-subedit-line"><input class="tx-clean-input" data-original-sub="'+enc(s)+'" value="'+safe(s)+'" maxlength="80"><button class="tx-remove-sub" type="button" data-delete-sub aria-label="Remove subcategory">×</button></div>').join("")+
 '<div class="tx-subedit-line"><input class="tx-clean-input" name="newSubcategory" maxlength="80" placeholder="New subcategory (optional)"><span class="tx-add-plus">＋</span></div></div>'+
 '<div class="tx-config-actions"><button type="submit" class="tx-save">Save changes</button><button type="button" class="tx-quiet" data-config-archive="'+safe(c.id)+'">Archive category</button></div>'+
 '</form>';
 return '<div class="tx-config-card">'+header+editor+'</div>';
}
async function saveCategory(form){
 const cat=categories.find(c=>c.id===form.dataset.categoryForm);if(!cat)return;
 const name=form.elements.name.value.trim();
 const color=form.elements.color.value;
 const subInputs=[...form.querySelectorAll("[data-original-sub]")];
 const renamePairs=subInputs.map(el=>[decodeURIComponent(el.dataset.originalSub),el.value.trim()]).filter(([old,n])=>n&&key(old)!==key(n));
 let newSubs=subInputs.map(el=>el.value.trim()).filter(Boolean);
 const added=form.elements.newSubcategory?.value.trim();
 if(added)newSubs.push(added);
 newSubs=[...new Map(newSubs.map(s=>[key(s),s])).values()];
 if(!name){notice("Category name cannot be empty.",true);return;}
 const originalName=cat.name, oldSubcats=cat.subcategories||[];
 const update=await client.from("horst_budget_categories").update({name,color,subcategories:newSubs}).eq("id",cat.id).eq("owner_id",user.id);
 if(update.error)throw update.error;
 if(key(originalName)!==key(name)){
  for(const table of ["horst_transactions","horst_transaction_rules"]){
   const r=await client.from(table).update({category:name}).eq("owner_id",user.id).eq("category",originalName);
   if(r.error)throw r.error;
  }
  rows.forEach(t=>{if(t.category===originalName)t.category=name;});
  rules.forEach(t=>{if(t.category===originalName)t.category=name;});
 }
 for(const [old,updated] of renamePairs){
  for(const table of ["horst_transactions","horst_transaction_rules"]){
   const r=await client.from(table).update({subcategory:updated}).eq("owner_id",user.id).eq("category",name).eq("subcategory",old);
   if(r.error)throw r.error;
  }
  rows.forEach(t=>{if(t.category===name&&t.subcategory===old)t.subcategory=updated;});
 }
 Object.assign(cat,{name,color,subcategories:newSubs});
 editingCategoryId=null;
 notice("Category updated.");
 renderDashboard();renderCategorySettings();
 if(typeof currentView!=="undefined"&&currentView==="home")renderHome();
}
async function submitCategoryCreation(form){
 const name=form.elements.name.value.trim();
 if(!name)return;
 await ensureCategory(name,"");
 editingCategoryId=null;renderCategorySettings();renderDashboard();
 notice("Category added.");
}
function applyPeriod(mode){
 const date=new Date(),two=n=>String(n).padStart(2,"0");
 if(mode==="all")filter.mode="all";
 if(mode==="this-month"){filter.mode="month";filter.month=today();}
 if(mode==="last-month"){
  date.setMonth(date.getMonth()-1);filter.mode="month";
  filter.month=date.getFullYear()+"-"+two(date.getMonth()+1);
 }
 if(mode==="this-year"){filter.mode="year";filter.year=String(date.getFullYear());}
 skipped=new Set();choice.id=null;notice("");filtersOpen=false;render();
}
root.addEventListener("click",async event=>{
 const el=event.target.closest("button,summary");if(!el)return;
 try{
 if(el.id==="txOpenFilters"){filtersOpen=!filtersOpen;if(filtersOpen)draftFilter={...filter};renderFilters();el.setAttribute("aria-expanded",String(filtersOpen));return;}
 if(el.id==="txCloseFilters"){filtersOpen=false;renderFilters();root.querySelector("#txOpenFilters")?.setAttribute("aria-expanded","false");return;}
 if(el.dataset.period){applyPeriod(el.dataset.period);return;}
 if(el.dataset.applyTime){
  const mode=el.dataset.applyTime;
  if(mode==="month"&&!/^\d{4}-\d{2}$/.test(draftFilter.month)){notice("Choose a valid month.",true);return;}
  if(mode==="year"&&!/^\d{4}$/.test(draftFilter.year)){notice("Choose a valid year.",true);return;}
  if(mode==="range"&&(!draftFilter.start||!draftFilter.end||draftFilter.start>draftFilter.end)){notice("Choose both dates, from earliest to latest.",true);return;}
  filter={...draftFilter,mode};filtersOpen=false;skipped=new Set();choice.id=null;notice("");render();return;
 }
 if(el.dataset.choiceCategory!==undefined){choose("category",decodeURIComponent(el.dataset.choiceCategory));return;}
 if(el.dataset.choiceSub!==undefined){choose("subcategory",decodeURIComponent(el.dataset.choiceSub));return;}
 if(el.dataset.choicePerson!==undefined){choose("person",decodeURIComponent(el.dataset.choicePerson));return;}
 if(el.dataset.choiceKind){choose("kind",el.dataset.choiceKind);return;}
 if(el.id==="txUndoAction"){await undoLast();return;}
 if(el.id==="txSaveCard"){await saveCurrent();return;}
 if(el.id==="txSkipCard"){skipCurrent();return;}
 if(el.id==="txReviewSkipped"){skipped=new Set();render();return;}
 if(el.dataset.catDrill){const name=decodeURIComponent(el.dataset.catDrill);activeCategoryDrill=activeCategoryDrill===name?null:name;render();return;}
 if(el.closest("#txHistoryDrawer>summary")){historyOpen=!root.querySelector("#txHistoryDrawer").open;return;}
 if(el.dataset.editTx){editHistoryId=editHistoryId===el.dataset.editTx?null:el.dataset.editTx;renderHistoryRows();return;}
 }catch(error){notice("Something went wrong: "+error.message,true);}
});
root.addEventListener("input",e=>{
 if(e.target.id==="txReviewCategory"){choice.category=e.target.value;}
 if(e.target.id==="txReviewSubcategory"){choice.subcategory=e.target.value;}
 if(e.target.id==="txReviewPerson"){choice.personTag=e.target.value;}
 if(e.target.id==="txHistorySearch"){historySearch=e.target.value;renderHistoryRows();}
});
root.addEventListener("change",e=>{
 const el=e.target;
 if(el.id==="txFilterMonth")draftFilter.month=el.value;
 if(el.id==="txFilterYear")draftFilter.year=el.value;
 if(el.id==="txFilterStart")draftFilter.start=el.value;
 if(el.id==="txFilterEnd")draftFilter.end=el.value;
});
root.addEventListener("submit",async e=>{
 const form=e.target;
 if(!form.matches(".tx-history-form"))return;
 e.preventDefault();const tx=rows.find(t=>t.id===form.dataset.editForm);if(!tx)return;
 const btn=form.querySelector('button[type="submit"]');btn.disabled=true;
 try{
  await persist(tx,form.elements.category.value,form.elements.subcategory.value,form.elements.kind.value,false,form.elements.person.value);
  editHistoryId=null;notice("Updated!");render();if(typeof currentView!=="undefined"&&currentView==="home")renderHome();
 }catch(error){notice("Unable to save: "+error.message,true);btn.disabled=false;}
});
document.addEventListener("click",async e=>{
 const el=e.target.closest("button");if(!el)return;
 const panel=document.getElementById("txCategorySettings");if(!panel||!panel.contains(el))return;
 if(el.dataset.configEdit){editingCategoryId=editingCategoryId===el.dataset.configEdit?null:el.dataset.configEdit;renderCategorySettings();return;}
 if(el.hasAttribute("data-delete-sub")){el.closest(".tx-subedit-line").remove();return;}
 if(el.dataset.configArchive){
   const cat=categories.find(c=>c.id===el.dataset.configArchive);if(!cat)return;
   if(!confirm('Archive "'+cat.name+'"? Previously categorized transactions will remain unchanged.'))return;
   const r=await client.from("horst_budget_categories").update({archived:true}).eq("id",cat.id).eq("owner_id",user.id);
   if(r.error){notice(r.error.message,true);return;}
   cat.archived=true;editingCategoryId=null;renderCategorySettings();render();notice("Category archived.");
 }
});
document.addEventListener("submit",async e=>{
 const panel=document.getElementById("txCategorySettings");
 if(!panel||!panel.contains(e.target))return;
 const form=e.target;
 if(form.id!=="txNewCategory"&&!form.classList.contains("tx-category-editor"))return;
 e.preventDefault();const btn=form.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
 try{if(form.id==="txNewCategory")await submitCategoryCreation(form);else await saveCategory(form);}
 catch(error){notice("Could not change category: "+error.message,true);if(btn)btn.disabled=false;}
});
root.addEventListener("pointerdown",e=>{
 const card=e.target.closest("#txSwipeCard");if(!card||e.target.closest("button,input,select,label,summary"))return;
 drag={id:e.pointerId,x:e.clientX,start:e.clientX,card};
});
root.addEventListener("pointermove",e=>{
 if(!drag||drag.id!==e.pointerId)return;
 const dx=e.clientX-drag.start;drag.x=e.clientX;
 if(Math.abs(dx)>8)drag.card.style.transform="translateX("+Math.max(-120,Math.min(120,dx))+"px) rotate("+dx/50+"deg)";
});
root.addEventListener("pointerup",e=>{
 if(!drag||drag.id!==e.pointerId)return;
 const dx=e.clientX-drag.start;
 if(drag.card?.isConnected)drag.card.style.transform="";
 drag=null;
 if(dx>95)saveCurrent();
 else if(dx< -95)skipCurrent();
});
document.addEventListener("keydown",e=>{
 if(typeof currentView==="undefined"||currentView!=="transactions"||!user)return;
 if(e.target.closest("input,textarea,select,[contenteditable]"))return;
 if((e.key==="z"||e.key==="Z")&&(e.ctrlKey||e.metaKey)){e.preventDefault();undoLast();return;}
 if(e.key==="ArrowRight"){e.preventDefault();saveCurrent();}
 if(e.key==="ArrowLeft"){e.preventDefault();skipCurrent();}
});
window.horstTransactions={
 preload,open:async()=>{await preload();render();},
 getOverview,renderCategorySettings,renderRecurringBills,
 refresh:async()=>{openPromise=null;await preload();}
};
})();
