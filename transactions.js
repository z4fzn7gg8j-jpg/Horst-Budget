/* Horst Budget Transactions: access is controlled by Supabase Auth + database RLS. */
(function () {
  "use strict";
  const root = document.getElementById("txRoot");
  if (!root) return;
  const money = value => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value) || 0);
  const safe = value => String(value == null ? "" : value).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
  const monthKey = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0");
  };
  let client = null;
  let currentUser = null;
  let rows = [];
  let rules = [];
  let pendingLoad = false;
  let selectedMonth = monthKey();
  let selectedStatus = "review";
  let initPromise = null;
  const categories = ["Bills & Utilities","Dining & Drinks","Education","Entertainment",
    "Family & Kids","Financial","Gifts & Donations","Groceries","Health & Wellness",
    "Housing","Income","Insurance","Other","Pets","Services","Shopping",
    "Transfers","Transportation & Travel"];
  function notice(message, error) {
    const target = root.querySelector("#txNotice");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("error", !!error);
  }
  function priorMonth(month) {
    const bits = month.split("-").map(Number);
    const d = new Date(bits[0], bits[1] - 2, 1);
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
  }
  function spendingValue(tx) {
    if (tx.pending || tx.exclude_from_spending || tx.kind === "transfer" || tx.kind === "income") return 0;
    if (tx.kind === "refund") return -Math.abs(Number(tx.amount) || 0);
    return Math.abs(Number(tx.amount) || 0);
  }
  function summarize(month) {
    const selected = rows.filter(t => String(t.txn_date).slice(0,7) === month);
    const total = selected.reduce((s,t) => s + spendingValue(t),0);
    const uncategorized = selected.filter(t => t.review_status !== "auto").length;
    const byCat = {};
    selected.forEach(t => {
      const value = spendingValue(t);
      if (!value) return;
      const category = t.category || "Uncategorized";
      byCat[category] = (byCat[category] || 0) + value;
    });
    return {total,uncategorized,byCat,selected};
  }
  function dateText(value) {
    const parts = String(value || "").split("-");
    if (parts.length !== 3) return String(value || "");
    return new Date(Number(parts[0]),Number(parts[1])-1,Number(parts[2])).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  }
  function displayName() {
    return currentUser && currentUser.email ? safe(currentUser.email) : "Signed in";
  }
  function renderAuth() {
    root.innerHTML = '<div class="card tx-auth">' +
      '<h2>Sign in to Transactions</h2>' +
      '<p>Your transaction history, merchant rules and reports are private. Sign in with an email link to access your own records.</p>' +
      '<form id="txSignIn"><div class="field"><label for="txEmail">Email address</label>' +
      '<input id="txEmail" class="text-input" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Email me a sign-in link</button></form>' +
      '<div id="txNotice" class="tx-message" role="status" aria-live="polite"></div>' +
      '<p class="tx-small">The first successful sign-in creates your private transaction workspace. You will need access to that same email account to sign in again.</p>' +
      '</div>';
  }
  function optionsList(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b))
      .map(v=>'<option value="'+safe(v)+'"></option>').join("");
  }
  function editForm(tx) {
    const category = safe(tx.category || tx.suggested_category || "");
    const subcategory = safe(tx.subcategory || tx.suggested_subcategory || "");
    const kinds = ["expense","income","transfer","refund"];
    return '<form class="tx-edit" data-tx-id="'+safe(tx.id)+'">' +
      '<div><label>Category<input class="text-input" type="text" list="txCategoryOptions" name="category" value="'+category+'" required placeholder="e.g. Dining & Drinks"></label></div>' +
      '<div><label>Subcategory<input class="text-input" type="text" list="txSubcategoryOptions" name="subcategory" value="'+subcategory+'" placeholder="e.g. Family"></label></div>' +
      '<div><label>Transaction type<select class="select-input" name="kind">' +
      kinds.map(k=>'<option value="'+k+'"'+(tx.kind===k?' selected':'')+'>'+k.charAt(0).toUpperCase()+k.slice(1)+'</option>').join("") +
      '</select></label></div>' +
      '<div class="tx-edit-actions">' +
      '<button class="btn btn-primary btn-sm" type="submit">Save classification</button>' +
      '<label><input type="checkbox" name="rememberRule"> Use for future '+safe(tx.merchant)+' charges</label>' +
      '</div></form>';
  }
  function rowHtml(tx) {
    const amount = Number(tx.amount);
    const state = ["auto","review","unsorted"].includes(tx.review_status) ? tx.review_status : "unsorted";
    const classification = [tx.category,tx.subcategory].filter(Boolean).join(" / ");
    const isSpend = spendingValue(tx)!==0;
    return '<article class="tx-row">' +
      '<div class="tx-row-top"><div><strong>'+safe(tx.merchant)+'</strong>' +
      '<small>'+safe(dateText(tx.txn_date))+(tx.account_name?' · '+safe(tx.account_name):"")+(tx.pending?" · Pending":"")+'</small></div>' +
      '<span class="tx-row-amount">'+(amount<0?"−":amount>0?"+":"")+money(Math.abs(amount))+'</span></div>' +
      '<span class="tx-label '+state+'">'+safe(classification || (state==="review"?"Suggestion needs review":"Not categorized"))+
      (tx.kind==="transfer"?" · Transfer":tx.kind==="income"?" · Income":tx.kind==="refund"?" · Refund":!isSpend?" · Excluded":"")+'</span>' +
      editForm(tx)+'</article>';
  }
  function renderDashboard() {
    const thisMonth = summarize(selectedMonth);
    const lastMonth = summarize(priorMonth(selectedMonth));
    const percent = lastMonth.total > 0 ? ((thisMonth.total-lastMonth.total)/lastMonth.total)*100 : null;
    const statuses = ["auto","review","unsorted"];
    const counts = {};
    statuses.forEach(st => counts[st] = thisMonth.selected.filter(tx=>tx.review_status===st).length);
    const filtered = thisMonth.selected.filter(tx=>tx.review_status===selectedStatus);
    const availableCats = categories.concat(rows.map(t=>t.category),rules.map(r=>r.category));
    const availableSubs = rows.map(t=>t.subcategory).concat(rules.map(r=>r.subcategory));
    const categoryTotals = Object.entries(thisMonth.byCat).sort((a,b)=>b[1]-a[1]);
    root.innerHTML =
      '<div class="tx-heading"><div><h1>Transactions</h1><p>Private spending history and category review</p></div>' +
      '<button class="btn tx-signout" id="txSignOut">Sign out</button></div>' +
      '<p class="tx-small">Signed in as '+displayName()+'</p>' +
      '<div id="txNotice" class="tx-message" role="status" aria-live="polite"></div>' +
      '<div class="tx-controls"><label for="txMonth">Month</label><input class="text-input" type="month" id="txMonth" value="'+safe(selectedMonth)+'"></div>' +
      '<div class="tx-summary">' +
        '<div class="tx-stat"><small>Monthly spending</small><strong>'+money(thisMonth.total)+'</strong></div>' +
        '<div class="tx-stat"><small>Vs. previous month</small><strong>'+(percent==null?'—':(percent>0?'+':'')+percent.toFixed(1)+'%')+'</strong></div>' +
        '<div class="tx-stat"><small>Needs your input</small><strong>'+thisMonth.uncategorized+'</strong></div>' +
      '</div>' +
      '<section class="card"><h2>Category spending</h2><p class="card-sub">Excludes transfers and income; refunds reduce spending.</p>' +
      (categoryTotals.length?categoryTotals.map(function(entry) {
        const old = lastMonth.byCat[entry[0]]||0;
        const diff = old ? ((entry[1]-old)/old*100).toFixed(0)+'%' : 'New / no prior spend';
        return '<div class="tx-cat-row"><span>'+safe(entry[0])+'<br><small class="tx-small">'+safe(diff)+' vs prior month</small></span><strong>'+money(entry[1])+'</strong></div>';
      }).join(""):'<p class="tx-empty">No spending data for this month yet.</p>')+'</section>' +
      '<section class="card"><h2>Transaction inbox</h2><p class="card-sub">Review suggestions, assign your own categories and save merchant rules.</p>' +
      '<div class="tx-status-tabs" role="group" aria-label="Transaction review status">' +
      statuses.map(function(st) {
        return '<button type="button" class="tx-filter" data-status="'+st+'" aria-pressed="'+String(selectedStatus===st)+'">'+
          (st==="auto"?"Auto / Confirmed":st==="review"?"Review":"Unsorted")+' ('+counts[st]+')</button>';
      }).join("")+'</div>' +
      '<datalist id="txCategoryOptions">'+optionsList(availableCats)+'</datalist>' +
      '<datalist id="txSubcategoryOptions">'+optionsList(availableSubs)+'</datalist>' +
      (pendingLoad?'<p class="tx-spinner">Loading your private transactions…</p>':
        filtered.length?filtered.map(rowHtml).join(""):'<p class="tx-empty">No '+selectedStatus+' transactions for this month.</p>') +
      '</section>' +
      '<p class="tx-small">New transactions are not imported automatically yet. We will enable daily imports after verifying the scheduled Finances-to-Supabase connection.</p>';
  }
  function render() {
    if (!client) {root.innerHTML='<p class="tx-spinner">Loading secure sign-in…</p>';return;}
    if (!currentUser) {renderAuth();return;}
    renderDashboard();
  }
  async function loadData() {
    if (!client || !currentUser) return;
    pendingLoad=true;
    render();
    const result=await Promise.all([
      client.from("horst_transactions").select("*").order("txn_date",{ascending:false}).limit(5000),
      client.from("horst_transaction_rules").select("*").order("created_at",{ascending:false})
    ]);
    pendingLoad=false;
    if (result[0].error || result[1].error) {
      render();
      notice("Could not load your private data: "+(result[0].error||result[1].error).message,true);
      return;
    }
    rows=result[0].data||[];
    rules=result[1].data||[];
    render();
  }
  async function initialize() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      root.innerHTML='<div class="card"><h2>Sign-in unavailable</h2><p>The authentication library did not load. Refresh the page and try again.</p></div>';
      return;
    }
    client=window.supabase.createClient(DEFAULT_SETTINGS.supabaseUrl,DEFAULT_SETTINGS.supabaseKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"horst-budget-private-tx"}
    });
    client.auth.onAuthStateChange(function(event,session){
      setTimeout(function(){
        const oldId=currentUser && currentUser.id;
        currentUser=session && session.user || null;
        if (!currentUser) {rows=[];rules=[];}
        if (oldId !== (currentUser && currentUser.id)) {
          render();
          if (currentUser) loadData();
        }
      },0);
    });
    try {
      const response=await client.auth.getUser();
      if (response.error && !/session missing/i.test(response.error.message||"")) {
        renderAuth();
        notice(response.error.message,true);
      }
      currentUser=response.data && response.data.user || null;
      render();
      if (currentUser) await loadData();
    } catch(error) {
      renderAuth();
      notice("Authentication could not be initialized: "+error.message,true);
    }
  }
  root.addEventListener("submit",async function(event) {
    if (event.target.id==="txSignIn") {
      event.preventDefault();
      if (!client) return;
      const form=event.target;
      const email=form.elements.email.value.trim();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      notice("Sending your sign-in link…");
      try {
        const redirect=window.location.origin + window.location.pathname + "?open=transactions";
        const result=await client.auth.signInWithOtp({email:email,options:{emailRedirectTo:redirect}});
        if (result.error) throw result.error;
        notice("Check your email for a sign-in link. Open it on this device to access Transactions.");
      } catch(err) {notice(err.message||"Could not send the sign-in link.",true);}
      finally {button.disabled=false;}
      return;
    }
    if (!event.target.matches(".tx-edit")) return;
    event.preventDefault();
    if (!currentUser) return;
    const form=event.target;
    const id=form.dataset.txId;
    const tx=rows.find(t=>String(t.id)===String(id));
    if (!tx) {notice("This transaction is no longer in your inbox.",true);return;}
    const category=form.elements.category.value.trim();
    const subcategory=form.elements.subcategory.value.trim();
    const kind=form.elements.kind.value;
    const remember=form.elements.rememberRule.checked;
    if (!category) {notice("Enter a category before saving.",true);return;}
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    notice("Saving classification…");
    try {
      const updated=await client.from("horst_transactions").update({
        category:category,subcategory:subcategory||null,kind:kind,
        exclude_from_spending:kind==="transfer",review_status:"auto",
        classification_origin:"manual",reviewed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("id",id).eq("owner_id",currentUser.id).select("id");
      if (updated.error) throw updated.error;
      if (!updated.data || updated.data.length!==1) throw new Error("The transaction could not be updated.");
      if (remember) {
        const rule=await client.from("horst_transaction_rules").upsert({
          owner_id:currentUser.id,merchant_match:tx.merchant.trim().toLowerCase(),
          category:category,subcategory:subcategory||null,kind:kind,
          exclude_from_spending:kind==="transfer",enabled:true
        },{onConflict:"owner_id,merchant_match"});
        if (rule.error) {
          await loadData();
          notice("Transaction saved, but the future merchant rule could not be saved: "+rule.error.message,true);
          return;
        }
      }
      await loadData();
      notice("Classification saved"+(remember?" and future merchant rule created.":"."));
    } catch(err) {button.disabled=false;notice("Could not save: "+(err.message||String(err)),true);}
  });
  root.addEventListener("click",async function(event) {
    const filter=event.target.closest("[data-status]");
    if (filter) {
      selectedStatus=filter.dataset.status;
      render();
      return;
    }
    if (event.target.closest("#txSignOut") && client) {
      const result=await client.auth.signOut();
      if (result.error) notice(result.error.message,true);
      else {currentUser=null;rows=[];rules=[];render();}
    }
  });
  root.addEventListener("change",function(event) {
    if (event.target.id==="txMonth" && /^\d{4}-\d{2}$/.test(event.target.value)) {
      selectedMonth=event.target.value;
      render();
    }
  });
  window.horstTransactions={
    open:function() {
      if (!initPromise) initPromise=initialize();
      else render();
      return initPromise;
    }
  };
  if (new URLSearchParams(window.location.search).get("open")==="transactions") {
    if (typeof setView === "function") setView("transactions");
  }
})();
