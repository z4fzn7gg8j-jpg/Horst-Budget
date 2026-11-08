/* Entire-site sign in. Shared Supabase session with Transactions. */
(function(){
  "use strict";
  const panel=document.getElementById("siteAuthScreen");
  if(!panel) return;
  let client=null, started=false, checking=false;
  const text=(message,bad=false)=>{
    const element=document.getElementById("siteAuthNotice");
    if(element){element.textContent=message||"";element.classList.toggle("error",bad);}
  };
  const showGate=()=>{
    document.body.classList.add("auth-pending");
    document.body.classList.remove("auth-ready");
    panel.hidden=false;
  };
  const showApp=()=>{
    document.body.classList.remove("auth-pending");
    document.body.classList.add("auth-ready");
    panel.hidden=true;
  };
  const init=async ()=>{
    showGate();
    if(!window.supabase || !window.supabase.createClient || typeof DEFAULT_SETTINGS === "undefined"){
      text("Secure sign-in could not load. Please refresh the page.",true);return;
    }
    client=window.supabase.createClient(
      DEFAULT_SETTINGS.supabaseUrl,DEFAULT_SETTINGS.supabaseKey,
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,
        storageKey:"horst-budget-private-tx"}}
    );
    window.horstAuthClient=client;
    const validate=async ()=>{
      if(checking)return;
      checking=true;
      try{
        const result=await client.auth.getUser();
        const user=result.data && result.data.user;
        if(!user){showGate();text("");return;}
        const membership=await client.from("horst_budget_members").select("role").eq("user_id",user.id).eq("active",true).maybeSingle();
        if(membership.error)throw membership.error;
        if(!membership.data){showGate();text("This email is signed in but does not have access to Horst Budget.",true);return;}
        window.horstBudgetCurrentUser=user;
        showApp();
        const account=document.getElementById("siteSignedInEmail");
        if(account)account.textContent=user.email||"Signed in";
        if(!started){
          started=true;
          await window.horstBudgetStart();
          const wanted=new URLSearchParams(location.search).get("open");
          if(["home","plan","transactions","bills","history","settings"].includes(wanted)){
            setView(wanted);
          }
          if(window.horstTransactions?.preload)await window.horstTransactions.preload();
        }
      }catch(error){showGate();text(error.message||"Authentication failed. Try again.",true);}
      finally{checking=false;}
    };
    client.auth.onAuthStateChange((event)=>{
      if(event==="SIGNED_OUT"){showGate();window.horstBudgetCurrentUser=null;}
      if(event==="SIGNED_IN"){setTimeout(validate,0);}
    });
    await validate();
    panel.addEventListener("submit",async(e)=>{
      if(e.target.id!=="siteAuthForm")return;
      e.preventDefault();
      const email=panel.querySelector("#siteAuthEmail").value.trim();
      const button=panel.querySelector("#siteAuthSubmit");
      if(!email)return;
      button.disabled=true;
      text("Sending your secure sign-in link…");
      try{
        // Use the already configured Transactions redirect URL.
        const redirect=location.origin+location.pathname+"?open=transactions";
        const result=await client.auth.signInWithOtp({
          email,options:{emailRedirectTo:redirect,shouldCreateUser:false}
        });
        if(result.error)throw result.error;
        text("Check your email for a sign-in link. Open it to access Horst Budget.");
      }catch(error){text(error.message||"Unable to send the sign-in link.",true);}
      finally{button.disabled=false;}
    });
    window.horstBudgetSignOut=async ()=>{
      if(!client)return;
      // Clear local copies of private budget data when signing out.
      const result=await client.auth.signOut();
      if(result.error){alert("Unable to sign out: "+result.error.message);return;}
      ["billPlannerState","billPlannerSyncBase","billPlannerRecoverySnapshots","billPlannerUser"]
        .forEach(key=>{try{localStorage.removeItem(key);}catch(_){}});
      window.horstBudgetCurrentUser=null;
      if(typeof state!=="undefined")state=null;
      started=false;
      showGate();
      text("Signed out.");
      window.location.reload();
    };
    document.addEventListener("click",e=>{
      const target=e.target.closest("#siteSignOut");
      if(target && window.horstBudgetSignOut)window.horstBudgetSignOut();
    });
  };
  init();
})();