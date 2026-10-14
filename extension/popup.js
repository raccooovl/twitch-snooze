(() => {
  "use strict";
  const chromeStoreId="fhdnokolfhacaokdidacdcabpimhgdkm", edgeStoreId="glcfgomfljbmcgomligjegknmhpebohm";
  // Prefer the installed store identity, including Chrome Web Store installs in Edge.
  const useEdgeStore=chrome.runtime.id===edgeStoreId ||
    (chrome.runtime.id!==chromeStoreId && /Edg\//.test(navigator.userAgent));
  document.getElementById("review-link").href=useEdgeStore
    ? `https://microsoftedge.microsoft.com/addons/detail/${edgeStoreId}`
    : `https://chromewebstore.google.com/detail/${chromeStoreId}/reviews`;
  const Core=globalThis.TwitchSnooze, UI=globalThis.TwitchSnoozeUI, t=UI.t;
  UI.localize();
  const $=id=>document.getElementById(id);
  const channels=$("channels"), feedback=$("feedback"), form=$("snooze-form"), input=$("channel-input"), duration=$("duration-input");
  const search=$("channel-search"), currentBox=$("current-channel"), peekSlot=$("peek-slot");
  const tabOutlet=$("manager-tabs"), streamerView=$("streamer-view"), categoryView=$("category-view"), keywordView=$("keyword-view"), whitelistView=$("whitelist-view");
  const views={streamers:streamerView,categories:categoryView,keywords:keywordView,whitelist:whitelistView};
  let state=Core.normalizeState(), view={peek:false}, expiryTimer, storageGeneration=0, submitting=false;
  let observations=[], overviewPending=false, selectedTab="streamers";
  let current=null, currentMenuOpen=false, currentPending=false;
  $("brand").append(UI.icon("moon"));
  $("search-field").prepend(UI.icon("search"));
  $("version").textContent=t("version",{version:chrome.runtime.getManifest().version});
  $("backup-link").addEventListener("click",()=>{chrome.runtime.openOptionsPage();window.close();});
  for(const preset of Core.PRESETS)duration.append(UI.element("option",{value:preset.key,text:preset.label}));
  duration.value="day";
  const nameFor=login=>(current?.login===login&&current.displayName)||observations.find(info=>info.login===login)?.displayName||login;

  function renderPeek(){peekSlot.replaceChildren(UI.peekToggle(view.peek,next=>{
    view={peek:next};renderPeek();
    try{chrome.storage.local.set({[Core.VIEW_KEY]:{peek:next}});}catch(_){}
    message(next?t("toastPeekOn"):t("toastPeekOff"));
    peekSlot.querySelector("button")?.focus();
  }));}
  function renderTabs(){
    const focused=tabOutlet.contains(document.activeElement)?document.activeElement.dataset.tab:null;
    tabOutlet.replaceChildren(UI.tabs(selectedTab,tab=>{selectedTab=tab;renderTabs();if(tab==="categories")renderCategories();if(tab==="keywords")renderKeywords();if(tab==="whitelist")renderWhitelist();},UI.managerCounts(state,observations)));
    for(const [key,section] of Object.entries(views))section.hidden=selectedTab!==key;
    if(focused)tabOutlet.querySelector('[data-tab="'+focused+'"]')?.focus({preventScroll:true});
  }
  async function change(request,text,busyView){
    UI.busy(busyView,true);const generation=storageGeneration;
    try{
      const result=await UI.request(request);
      const added={TSNOOZE_WHITELIST_SET:whitelistView,TSNOOZE_RULE_SET:categoryView,TSNOOZE_FILTER_SET:keywordView}[request.type];
      if(added&&busyView.tagName==="FORM"&&added.querySelector(".sz-category-form input"))added.querySelector(".sz-category-form input").value="";
      if(generation===storageGeneration)applyState(result.state);
      message(text,result.undo);
      return result;
    }catch(error){errorMessage(error);return null;}
    finally{UI.busy(busyView,false);}
  }
  function keepDraft(section,render){
    const draft=section.querySelector(".sz-category-form input")?.value;
    const focused=section.contains(document.activeElement)&&document.activeElement.matches("input");
    section.replaceChildren(render());
    if(draft)section.querySelector(".sz-category-form input").value=draft;
    if(focused)section.querySelector(".sz-category-form input")?.focus({preventScroll:true});
  }
  function renderCategories(){keepDraft(categoryView,()=>UI.categories(state,{observations,
    onAdd:(category,form)=>change({type:"TSNOOZE_RULE_SET",category},t("toastCategoryAdded",{category:category.name}),form),
    onRemove:(id,rule)=>change({type:"TSNOOZE_RULE_REMOVE",id},t("toastCategoryShown",{category:rule.category.name}),categoryView),
    onException:(id,login)=>change({type:"TSNOOZE_RULE_EXCEPTION",id,login,allow:false},t("toastExceptionRemoved"),categoryView)}));}
  function renderKeywords(){keepDraft(keywordView,()=>UI.keywords(state,{observations,
    onAdd:(keyword,form)=>change({type:"TSNOOZE_FILTER_SET",text:keyword},t("toastKeywordAdded",{keyword}),form),
    onRemove:(id,filter)=>change({type:"TSNOOZE_FILTER_REMOVE",id},t("toastKeywordRemoved",{keyword:filter.text}),keywordView),
    onException:(id,login)=>change({type:"TSNOOZE_FILTER_EXCEPTION",id,login,allow:false},t("toastExceptionRemoved"),keywordView)}));}
  function renderWhitelist(){keepDraft(whitelistView,()=>UI.whitelist(state,{observations,
    onAdd:(login,form)=>change({type:"TSNOOZE_WHITELIST_SET",login,displayName:nameFor(login)},t("toastAlwaysShow",{name:nameFor(login)}),form),
    onRemove:(login,item)=>change({type:"TSNOOZE_WHITELIST_REMOVE",login},t("toastStopAlways",{name:item?.displayName||login}),whitelistView)}));}
  async function refreshOverview(){
    if(overviewPending)return;overviewPending=true;
    try{const result=await UI.request({type:"TSNOOZE_OVERVIEW"});const next=result.observations||[];if(JSON.stringify(next)!==JSON.stringify(observations)){observations=next;renderEntries();renderTabs();if(selectedTab==="keywords")renderKeywords();if(selectedTab==="whitelist")renderWhitelist();renderCurrent();}}
    catch(error){errorMessage(error);}
    finally{overviewPending=false;}
  }
  function applyState(next,authoritative=false) {
    if(!next||(!authoritative&&Number(next.revision)<state.revision))return;
    state=Core.normalizeState(next);render();
  }
  function errorMessage(error) {
    feedback.replaceChildren(UI.element("p",{class:"sz-alert",role:"alert",text:error.message}));
  }
  function message(text,undo) {
    const box=UI.toastView(text,undo?async()=>{
      UI.busy(box,true);const generation=storageGeneration;
      try{const result=await UI.request({type:"TSNOOZE_UNDO",undo});if(generation===storageGeneration)applyState(result.state);message(t("toastUndone"));}
      catch(error){errorMessage(error);}
    }:null);
    feedback.replaceChildren(box);
  }
  // The channel open in the active tab, so it can be hidden without finding it in the sidebar.
  async function loadCurrent(){
    try{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab||!Number.isSafeInteger(tab.id))return;
      const reply=await Promise.race([chrome.tabs.sendMessage(tab.id,{type:"TSNOOZE_CURRENT"}),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);
      const login=Core.normalizeLogin(reply?.channel?.login);
      if(!login)return;
      current={login,displayName:Core.normalizeDisplayName(reply.channel.displayName,login),category:Core.normalizeCategory(reply.channel.category),avatar:Core.normalizeAvatar(reply.channel.avatar)};
      renderCurrent();
    }catch(_){/* Not a Twitch tab, or Twitch Snooze has not loaded there yet. */}
  }
  async function currentChange(request,text){
    if(currentPending)return;
    currentPending=true;UI.busy(currentBox,true);const generation=storageGeneration;
    try{const result=await UI.request(request);currentMenuOpen=false;if(generation===storageGeneration)applyState(result.state);message(text,result.undo);}
    catch(error){errorMessage(error);}
    finally{currentPending=false;UI.busy(currentBox,false);renderCurrent();}
  }
  function renderCurrent(){
    if(!current){currentBox.hidden=true;currentBox.replaceChildren();return;}
    const {login,displayName:name,category}=current;
    const info={login,displayName:name,category};
    const whitelisted=Core.isWhitelisted(state,login);
    const reasons=Core.hiddenReasons(state,info);
    const status=whitelisted?t("alwaysShown"):reasons.length?UI.reasonTextsFor(reasons)[0]:category?t("statusLiveIn",{category:category.name}):t("statusOnChannel");
    const actions=UI.element("div",{class:"sz-current-actions"});
    if(reasons.length)actions.append(UI.element("button",{type:"button",class:"sz-primary sz-restore",onclick:()=>currentChange(UI.restoreRequest(state,login,[...observations,info]),t("toastBack",{name}))},UI.element("span",{text:t("menuShowNow",{name})})));
    else if(whitelisted)actions.append(UI.element("button",{type:"button",class:"sz-secondary sz-wide",onclick:()=>currentChange({type:"TSNOOZE_WHITELIST_REMOVE",login},t("toastStopAlways",{name}))},t("menuStopAlwaysShow",{name})));
    else actions.append(
      UI.element("button",{type:"button",class:"sz-primary sz-current-toggle","aria-expanded":String(currentMenuOpen),onclick:()=>{currentMenuOpen=!currentMenuOpen;renderCurrent();if(currentMenuOpen)currentBox.querySelector(".sz-duration.default")?.focus({preventScroll:true});}},UI.icon("moon"),UI.element("span",{text:t("popupSnooze",{name})})),
      UI.element("button",{type:"button",class:"sz-secondary sz-current-always",onclick:()=>currentChange({type:"TSNOOZE_WHITELIST_SET",login,displayName:name},t("toastAlwaysShow",{name}))},t("popupAlwaysShow")));
    const children=[UI.element("div",{class:"sz-current-head"},UI.avatar(login,name,!reasons.length&&category?"live":"",Core.avatarFor(state,login)||current.avatar),
      UI.element("div",{class:"sz-row-text"},UI.element("span",{class:"sz-current-name",text:name,title:name}),UI.element("span",{class:"sz-current-status",text:status,title:status}))),actions];
    if(currentMenuOpen&&!reasons.length&&!whitelisted){
      const menu=UI.menu(login,name,chosen=>currentChange({type:"TSNOOZE_SET",login,displayName:name,duration:chosen},Core.snoozedMessage(name,chosen)),()=>{currentMenuOpen=false;renderCurrent();currentBox.querySelector(".sz-current-toggle")?.focus();},{
        category,
        onRule:scope=>currentChange({type:"TSNOOZE_RULE_SET",category,...(scope==="channel"?{login,displayName:name}:{})},scope==="channel"?t("toastWhilePlaying",{name,category:category.name}):t("toastCategoryHidden",{category:category.name}))
      });
      menu.querySelector(".sz-panel-intro")?.remove();
      children.push(menu);
    }
    currentBox.replaceChildren(...children);currentBox.hidden=false;
  }
  function renderEntries() {
    const focused=channels.querySelector(":focus")?.closest("[data-login]")?.dataset.login;
    channels.replaceChildren(UI.entries(state,async (login,item)=>{
      const rows=[...channels.querySelectorAll("[data-login]")],index=rows.findIndex(row=>row.dataset.login===login);
      const name=item?.displayName||login;
      UI.busy(channels,true);const generation=storageGeneration;
      try{
        const result=await UI.request(UI.restoreRequest(state,login,observations));
        if(generation===storageGeneration)applyState(result.state);
        message(t("toastBack",{name}),result.undo);
        if(document.activeElement!==search){
          const buttons=[...channels.querySelectorAll(".sz-restore")];
          (buttons[Math.min(index,buttons.length-1)]||feedback.querySelector(".sz-undo"))?.focus();
        }
      }catch(error){UI.busy(channels,false);errorMessage(error);}
    },{query:search.value,observations,
      onChange:(login,chosen,item)=>change({type:"TSNOOZE_SET",login,displayName:item.displayName,duration:chosen},Core.snoozedMessage(item.displayName,chosen),channels),
      onWhitelist:item=>change({type:"TSNOOZE_WHITELIST_SET",login:item.login,displayName:item.displayName},t("toastAlwaysShow",{name:item.displayName}),channels)}));
    if(focused)channels.querySelector('[data-login="'+CSS.escape(focused)+'"] .sz-restore')?.focus({preventScroll:true});
  }
  function render() {
    state=Core.normalizeState(state);
    renderTabs();renderEntries();renderCategories();renderKeywords();renderWhitelist();renderCurrent();refreshOverview();
    clearTimeout(expiryTimer);
    const next=Math.min(...Object.values(state.snoozes).map(item=>item.until).filter(until=>until!==null));
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
    if(!login){errorMessage(new Error(t("errEnterChannel")));input.focus();return;}
    submitting=true;
    const name=nameFor(login);
    const result=await change({type:"TSNOOZE_SET",login,displayName:name,duration:chosen},Core.snoozedMessage(name,chosen),form);
    if(result)input.value="";
    submitting=false;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes[Core.VIEW_KEY]){const next=Boolean(changes[Core.VIEW_KEY].newValue?.peek);if(next!==view.peek){view={peek:next};renderPeek();}}
    if(!changes[Core.STORAGE_KEY])return;
    if(!feedback.querySelector(".sz-undo"))feedback.replaceChildren();
    storageGeneration++;applyState(Core.normalizeState(changes[Core.STORAGE_KEY].newValue),true);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&currentMenuOpen){event.preventDefault();currentMenuOpen=false;renderCurrent();currentBox.querySelector(".sz-current-toggle")?.focus();}
  });
  setInterval(renderEntries,60000);
  setInterval(refreshOverview,2500);
  try{chrome.storage.local.get(Core.VIEW_KEY).then(stored=>{view={peek:Boolean(stored?.[Core.VIEW_KEY]?.peek)};renderPeek();}).catch(()=>renderPeek());}catch(_){renderPeek();}
  renderPeek();renderTabs();refresh();loadCurrent();
})();
