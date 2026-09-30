(() => {
  "use strict";
  const Core=globalThis.TwitchSnooze, UI=globalThis.TwitchSnoozeUI;
  const channels=document.getElementById("channels"), count=document.getElementById("count");
  const feedback=document.getElementById("feedback"), form=document.getElementById("snooze-form");
  const input=document.getElementById("channel-input"), duration=document.getElementById("duration-input");
  const search=document.getElementById("channel-search"), editor=document.getElementById("duration-editor");
  let state=Core.normalizeState(), expiryTimer, storageGeneration=0;
  let submitting=false, editingLogin=null, editingPending=false;
  let observations=[], overviewPending=false, selectedTab="streamers";
  const tabOutlet=document.getElementById("manager-tabs"),streamerView=document.getElementById("streamer-view"),categoryView=document.getElementById("category-view"),whitelistView=document.getElementById("whitelist-view");
  document.getElementById("scope-note").append(UI.scopeNote());
  function renderTabs(){const focused=tabOutlet.contains(document.activeElement)?document.activeElement.dataset.tab:null;tabOutlet.replaceChildren(UI.tabs(selectedTab,tab=>{selectedTab=tab;renderTabs();if(tab==="categories")renderCategories();if(tab==="whitelist")renderWhitelist();},UI.managerCounts(state,observations)));streamerView.hidden=selectedTab!=="streamers";categoryView.hidden=selectedTab!=="categories";whitelistView.hidden=selectedTab!=="whitelist";if(focused)tabOutlet.querySelector('[data-tab="'+focused+'"]')?.focus({preventScroll:true});}
  async function ruleChange(request,text,view=categoryView){
    UI.busy(view,true);const generation=storageGeneration;
    try{const result=await UI.request(request);
      const addedTo=view.tagName!=="FORM"?null:request.type==="TSNOOZE_WHITELIST_SET"?whitelistView:request.type==="TSNOOZE_RULE_SET"?categoryView:null;
      if(addedTo?.querySelector("input"))addedTo.querySelector("input").value="";
      if(generation===storageGeneration)applyState(result.state);message(text);}
    catch(error){errorMessage(error);}
    finally{UI.busy(view,false);}
  }
  function renderCategories(){
    const draft=categoryView.querySelector("input")?.value;
    categoryView.replaceChildren(UI.categories(state,{observations,onAdd:(category,form)=>ruleChange({type:"TSNOOZE_RULE_SET",category},category.name+" hidden.",form),onRemove:id=>ruleChange({type:"TSNOOZE_RULE_REMOVE",id},"Category restored."),onException:(id,login)=>ruleChange({type:"TSNOOZE_RULE_EXCEPTION",id,login,allow:false},"Exception removed.")}));
    if(draft)categoryView.querySelector("input").value=draft;
  }
  function renderWhitelist(){
    const draft=whitelistView.querySelector("input")?.value;
    const focused=whitelistView.contains(document.activeElement);
    whitelistView.replaceChildren(UI.whitelist(state,{onAdd:(login,form)=>ruleChange({type:"TSNOOZE_WHITELIST_SET",login},login+" will always be shown.",form),onRemove:login=>ruleChange({type:"TSNOOZE_WHITELIST_REMOVE",login},login+" removed from whitelist.",whitelistView)}));
    if(draft)whitelistView.querySelector("input").value=draft;
    if(focused)whitelistView.querySelector("input")?.focus({preventScroll:true});
  }
  async function refreshOverview(){
    if(overviewPending)return;overviewPending=true;
    try{const result=await UI.request({type:"TSNOOZE_OVERVIEW"});const next=result.observations||[];if(JSON.stringify(next)!==JSON.stringify(observations)){observations=next;renderEntries();renderTabs();count.textContent=String(UI.hiddenItems(state,observations).length);}}
    catch(error){errorMessage(error);}
    finally{overviewPending=false;}
  }
  document.getElementById("brand").append(UI.icon("moon"));
  document.getElementById("version").textContent="v"+chrome.runtime.getManifest().version;
  for(const preset of Core.PRESETS)duration.append(UI.element("option",{value:preset.key,text:preset.label}));
  duration.value="day";
  function applyState(next,authoritative=false) {
    if(!next||(!authoritative&&Number(next.revision)<state.revision))return;
    state=Core.normalizeState(next);render();
  }
  function errorMessage(error) {
    feedback.replaceChildren(UI.element("p",{class:"sz-alert",role:"alert",text:error.message}));
  }
  function message(text,undo) {
    const view=UI.element("div",{class:"sz-toast",role:"status"},UI.icon("check"),UI.element("span",{class:"sz-toast-text",text}));
    if(undo)view.append(UI.element("button",{type:"button",class:"sz-undo",onclick:async()=>{
      UI.busy(view,true);const generation=storageGeneration;
      try{const result=await UI.request({type:"TSNOOZE_UNDO",undo});if(generation===storageGeneration)applyState(result.state);message("Snooze change undone.");}
      catch(error){errorMessage(error);}
    }},"Undo"));
    feedback.replaceChildren(view);
  }
  function renderEditor(focus=false) {
    const item=editingLogin&&Object.hasOwn(state.snoozes,editingLogin)&&!Core.isWhitelisted(state,editingLogin)?state.snoozes[editingLogin]:null;
    if(!item){editingLogin=null;editor.replaceChildren();return;}
    const login=item.login;
    const view=UI.menu(login,item.displayName,async chosen=>{
      if(editingPending)return;
      editingPending=true;UI.busy(view,true);const generation=storageGeneration;
      try{
        const result=await UI.request({type:"TSNOOZE_SET",login,displayName:item.displayName,duration:chosen});
        if(editingLogin===login)editingLogin=null;
        if(generation===storageGeneration)applyState(result.state);else renderEditor();
        message(chosen==="today"?item.displayName+" snoozed until midnight.":item.displayName+" snoozed for "+Core.PRESETS.find(p=>p.key===chosen).label.toLowerCase()+".",result.undo);
        channels.querySelector('[data-login="'+login+'"] .sz-change')?.focus();
      }catch(error){errorMessage(error);}
      finally{editingPending=false;if(editingLogin)renderEditor();}
    },()=>{editingLogin=null;editor.replaceChildren();channels.querySelector('[data-login="'+login+'"] .sz-change')?.focus();});
    view.querySelector(".sz-name").textContent="Change duration for "+item.displayName;
    UI.busy(view,editingPending);editor.replaceChildren(view);
    if(focus){view.scrollIntoView({block:"nearest"});view.querySelector(".sz-preset.default")?.focus({preventScroll:true});}
  }
  function renderEntries() {
    const focused=channels.querySelector(":focus")?.closest("[data-login]")?.dataset.login;
    channels.replaceChildren(UI.entries(state,async login=>{
      const rows=[...channels.querySelectorAll("[data-login]")],index=rows.findIndex(row=>row.dataset.login===login);
      const displayName=state.snoozes[login]?.displayName||login;
      UI.busy(channels,true);const generation=storageGeneration;
      try{
        const result=await UI.request(UI.restoreRequest(state,login,observations));
        if(generation===storageGeneration)applyState(result.state);
        message(displayName+" is back in your channels.",result.undo);
        if(document.activeElement!==search){
          const buttons=[...channels.querySelectorAll(".sz-restore")];
          (buttons[Math.min(index,buttons.length-1)]||feedback.querySelector(".sz-undo"))?.focus();
        }
      }catch(error){UI.busy(channels,false);errorMessage(error);}
    },{query:search.value,observations,onChange:login=>{editingLogin=login;renderEditor(true);},onWhitelist:item=>ruleChange({type:"TSNOOZE_WHITELIST_SET",login:item.login,displayName:item.displayName},item.displayName+" will always be shown.",channels)}));
    if(focused)channels.querySelector('[data-login="'+focused+'"] .sz-restore')?.focus({preventScroll:true});
  }
  function render() {
    state=Core.normalizeState(state);count.textContent=String(UI.hiddenItems(state,observations).length);
    renderTabs();renderEntries();renderEditor();renderCategories();renderWhitelist();refreshOverview();
    clearTimeout(expiryTimer);
    const next=Math.min(...Object.values(state.snoozes).map(item=>item.until));
    if(Number.isFinite(next))expiryTimer=setTimeout(refresh,Math.min(2147483000,Math.max(20,next-Date.now()+20)));
  }
  async function refresh() {
    const generation=storageGeneration;
    try{const result=await UI.request({type:"TSNOOZE_GET"});if(generation===storageGeneration)applyState(result.state);}
    catch(error){errorMessage(error);}
  }
  search.addEventListener("input",renderEntries);
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(submitting)return;
    const login=Core.normalizeLogin(input.value),chosen=duration.value;
    if(!login){errorMessage(new Error("Enter a Twitch channel name or channel link."));input.focus();return;}
    submitting=true;UI.busy(form,true);const generation=storageGeneration;
    try{
      const result=await UI.request({type:"TSNOOZE_SET",login,displayName:login,duration:chosen});
      if(generation===storageGeneration)applyState(result.state);input.value="";
      message(chosen==="today"?login+" snoozed until midnight.":login+" snoozed for "+Core.PRESETS.find(p=>p.key===chosen).label.toLowerCase()+".",result.undo);
    }catch(error){errorMessage(error);}
    finally{submitting=false;UI.busy(form,false);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local"||!changes[Core.STORAGE_KEY])return;
    if(!feedback.querySelector(".sz-undo"))feedback.replaceChildren();
    storageGeneration++;applyState(Core.normalizeState(changes[Core.STORAGE_KEY].newValue),true);
  });
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&editingLogin){event.preventDefault();const login=editingLogin;editingLogin=null;editor.replaceChildren();channels.querySelector('[data-login="'+login+'"] .sz-change')?.focus();}});
  setInterval(()=>{renderEntries();},60000);
  setInterval(refreshOverview,2500);
  renderTabs();refresh();
})();
