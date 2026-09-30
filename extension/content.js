(() => {
  "use strict";
  if (globalThis.__twitchSnoozeLoaded) return;
  globalThis.__twitchSnoozeLoaded = true;
  const Core=globalThis.TwitchSnooze, UI=globalThis.TwitchSnoozeUI;
  const controls=new Map(), hiddenNodes=new Set();
  const CARD_LINKS='a[data-a-target="preview-card-channel-link"][href],a[data-a-target="preview-card-image-link"][href]';
  let state=Core.normalizeState(), panel=null, manager=null, toast=null;
  let scanTimer=null, expiryTimer=null, toastTimer=null, nav=null, navWidth=0;
  let stopped=false, storageGeneration=0, managerQuery="", managerTab="streamers", managerObservations=[], overviewPending=false;

  function sideRows(){return [...document.querySelectorAll(".side-nav-card")].filter(row=>!row.parentElement?.closest(".side-nav-card"));}
  function categoryInfo(node,type){
    const label=type==="sidebar"?node.querySelector('.side-nav-card__metadata p,[data-a-target="side-nav-game-title"],.side-nav-card-metadata .game'):type==="category"?node.querySelector('[data-a-target="tw-card-title"] h2'):node.querySelector('a[data-a-target="preview-card-game-link"]');
    return Core.normalizeCategory(label?.textContent?.trim()||label?.getAttribute("title"));
  }

  function channelInfo(row) {
    const link=row.querySelector('a.side-nav-card__link[href],a.side-nav-card[href]');
    const login=Core.normalizeLogin(link?.getAttribute("href"));
    if(!login)return null;
    return {login,displayName:Core.normalizeDisplayName(row.querySelector('[data-a-target="side-nav-title"]')?.textContent||link.querySelector("img")?.alt,login),category:categoryInfo(row,"sidebar")};
  }
  function cardInfo(card) {
    const link=card.querySelector('a[data-a-target="preview-card-channel-link"][href]') || card.querySelector('a[data-a-target="preview-card-image-link"][href]');
    const login=Core.normalizeLogin(link?.getAttribute("href"));
    if(!login)return null;
    const label=card.querySelector('a[data-a-target="preview-card-channel-link"] p[title]')||card.querySelector('a[data-a-target="preview-card-channel-link"] p');
    const name=label?.getAttribute("title")||[...(label?.childNodes||[])].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join("");
    return {login,displayName:Core.normalizeDisplayName(name,login),category:categoryInfo(card,"card")};
  }
  function infoFor(node,type) {if(type==="category"){const category=categoryInfo(node,type);return category?{login:null,displayName:category.name,category}:null;}return type==="card"?cardInfo(node):channelInfo(node);}
  function observations(){return [...sideRows().map(channelInfo),...[...discoveryCards()].map(cardInfo)].filter(Boolean);}
  async function refreshOverview(){
    if(stopped||overviewPending||panel?.kind!=="manager")return;
    overviewPending=true;
    try{const result=await UI.request({type:"TSNOOZE_OVERVIEW"});const next=result.observations||[];if(JSON.stringify(next)!==JSON.stringify(managerObservations)){managerObservations=next;if(managerTab==="streamers")renderManagerPanel();}}
    catch(error){if(panel?.kind==="manager")UI.alert(panel.mount.container,error);}
    finally{overviewPending=false;}
  }
  function compact() {return Boolean(nav&&nav.getBoundingClientRect().width<130);}
  function gridItem(card) {
    const tower=card.closest(".tw-tower");
    if(!tower)return card;
    let item=card;
    while(item.parentElement&&item.parentElement!==tower)item=item.parentElement;
    return item.querySelectorAll("article,.game-card").length<=1?item:card;
  }
  function discoveryCards() {
    const cards=new Set();
    for(const link of document.querySelectorAll(CARD_LINKS)){
      const card=link.closest('article,.preview-card,[data-target="directory-game__card_container"]');
      if(card)cards.add(card);
    }
    return cards;
  }
  function setHidden(node,hidden) {
    if(hidden){if(node.getAttribute("data-tsnz-hidden")!=="true")node.setAttribute("data-tsnz-hidden","true");hiddenNodes.add(node);}
    else{node.removeAttribute("data-tsnz-hidden");hiddenNodes.delete(node);}
  }
  function applyFilters() {
    const next=new Set();
    const known=new Map();
    for(const info of observations())if(info.category){const previous=known.get(info.login);known.set(info.login,known.has(info.login)&&previous?.key!==info.category.key?null:info.category);}
    const hidden=info=>info&&Core.hiddenReasons(state,info.category?info:{...info,category:known.get(info.login)||null}).length>0;
    for(const row of sideRows()){
      if(hidden(channelInfo(row)))next.add(row);
    }
    for(const card of discoveryCards()){
      if(hidden(cardInfo(card)))next.add(gridItem(card));
    }
    for(const card of document.querySelectorAll(".game-card")){const category=categoryInfo(card,"category");if(category&&Object.hasOwn(state.rules,Core.ruleId(category)))next.add(gridItem(card));}
    for(const node of hiddenNodes)if(!next.has(node))setHidden(node,false);
    for(const node of next)setHidden(node,true);
  }
  function closePanel(restoreFocus=false) {
    if(!panel)return;
    const previous=panel;panel=null;previous.mount.host.remove();
    for(const control of controls.values())control.button.setAttribute("aria-expanded","false");
    manager?.button.setAttribute("aria-expanded","false");
    if(restoreFocus&&previous.trigger?.isConnected)previous.trigger.focus();
  }
  function locatePanel() {
    if(!panel?.floating)return;
    const {mount,trigger}=panel;
    if(!trigger.isConnected){closePanel();return;}
    const rect=trigger.getBoundingClientRect();
    if(rect.bottom<0||rect.top>innerHeight){closePanel();return;}
    const width=Math.min(panel.kind==="manager"?420:270,Math.max(0,innerWidth-20));
    mount.host.style.width=width+"px";
    mount.host.style.left=Math.max(10,Math.min(rect.right+(panel.kind==="manager"?12:6),innerWidth-width-10))+"px";
    mount.host.style.top=Math.max(10,Math.min(rect.top,innerHeight-mount.host.getBoundingClientRect().height-10))+"px";
  }
  function attachPanel(trigger,target,kind,type="sidebar") {
    const floating=kind==="manager"||type!=="sidebar"||compact();
    const mount=UI.mount(kind==="manager"?"manager-panel":floating?"floating":"inline");
    if(floating)document.body.append(mount.host);
    else if(target)target.after(mount.host);
    else manager.mount.host.after(mount.host);
    panel={mount,trigger,target,kind,type,floating};
    trigger.setAttribute("aria-expanded","true");
    return mount;
  }
  function focusMenu(mount,view) {
    mount.ready.then(()=>{
      if(panel?.mount!==mount||!view.isConnected)return;
      locatePanel();
      if(!panel.floating)view.scrollIntoView({block:"nearest",inline:"nearest"});
      (view.querySelector(".sz-preset.default")||view.querySelector(".sz-whitelist-action"))?.focus({preventScroll:true});
    });
  }
  function announce(info,duration,undo) {
    const label=Core.PRESETS.find(preset=>preset.key===duration).label.toLowerCase();
    showToast(duration==="today"?info.displayName+" snoozed until midnight.":info.displayName+" snoozed for "+label+".",undo);
  }
  function showMenu(target,trigger,type) {
    const info=infoFor(target,type);
    if(!info||(Object.hasOwn(state.snoozes,info.login)&&!Core.isWhitelisted(state,info.login)))return;
    const same=panel?.kind==="menu"&&panel?.target===target;
    closePanel();if(same)return;
    const mount=attachPanel(trigger,target,"menu",type);panel.login=info.login;panel.categoryKey=info.category?.key;
    const saveRule=async scope=>{
      UI.busy(view,true);const generation=storageGeneration;
      try{
        const result=await UI.request({type:"TSNOOZE_RULE_SET",category:info.category,...(scope==="channel"?{login:info.login,displayName:info.displayName}:{})});
        if(generation===storageGeneration)applyState(result.state);
        if(panel?.mount===mount)closePanel();
        showToast(scope==="channel"?info.displayName+" hidden while playing "+info.category.name+".":info.category.name+" hidden. Manage exceptions in Hidden Content.");
        if(!panel)manager?.button.focus({preventScroll:true});
      }catch(error){UI.busy(view,false);UI.alert(view,error);}
    };
    const view=type==="category"?UI.panel("Hide "+info.category.name,()=>closePanel(true)):UI.menu(info.login,info.displayName,async duration=>{
      UI.busy(view,true);const generation=storageGeneration;
      try{
        const result=await UI.request({type:"TSNOOZE_SET",...info,duration});
        if(generation===storageGeneration)applyState(result.state);
        if(panel?.mount===mount)closePanel();
        announce(info,duration,result.undo);
        if(!panel)manager?.button.focus({preventScroll:true});
      }catch(error){UI.busy(view,false);UI.alert(view,error);}
    },()=>closePanel(true),{category:info.category,onRule:saveRule,whitelisted:Core.isWhitelisted(state,info.login),onWhitelist:async allow=>{
      UI.busy(view,true);const generation=storageGeneration;
      try{const result=await UI.request({type:allow?"TSNOOZE_WHITELIST_SET":"TSNOOZE_WHITELIST_REMOVE",login:info.login,displayName:info.displayName});if(generation===storageGeneration)applyState(result.state);if(panel?.mount===mount)closePanel();showToast(allow?info.displayName+" will always be shown.":info.displayName+" removed from whitelist.");}
      catch(error){UI.busy(view,false);UI.alert(view,error);}
    }});
    if(type==="category")view.append(UI.element("p",{class:"sz-caption",text:"Hide this category and its streams. You can restore favourite streamers individually."}),UI.element("button",{type:"button",class:"sz-submit sz-rule-action","data-scope":"category",onclick:()=>saveRule("category"),text:"Hide category"}));
    mount.container.replaceChildren(view);focusMenu(mount,view);
  }
  function renderManagerPanel() {
    if(panel?.kind!=="manager")return;
    const current=panel, active=current.mount.root.activeElement;
    const activeTab=active?.dataset.tab;
    const scrollTop=current.tab===managerTab?current.mount.root.querySelector(".sz-manager-body")?.scrollTop||0:0;
    const activeLogin=active?.closest("[data-login]")?.dataset.login;
    const searching=active?.classList.contains("sz-search");
    const selection=searching?[active.selectionStart,active.selectionEnd]:null;
    const draft=current.mount.root.querySelector(".sz-category-form input")?.value;
    const draftFocused=active?.closest(".sz-category-form");
    const view=UI.element("section",{class:"sz-panel sz-manager-panel",role:"dialog","aria-label":"Hidden Content","aria-modal":"false"},UI.managerHeader(()=>closePanel(true)));
    const change=async(message,text)=>{UI.busy(view,true);const generation=storageGeneration;try{const result=await UI.request(message);
      if(panel===current&&((message.type==="TSNOOZE_WHITELIST_SET"&&managerTab==="whitelist")||(message.type==="TSNOOZE_RULE_SET"&&managerTab==="categories"))){const savedInput=current.mount.root.querySelector(".sz-category-form input");if(savedInput)savedInput.value="";}
      if(generation===storageGeneration)applyState(result.state);showToast(text);}catch(error){UI.busy(view,false);UI.alert(view,error);}};
    const switcher=UI.tabs(managerTab,tab=>{managerTab=tab;renderManagerPanel();},UI.managerCounts(state,managerObservations));
    const search=UI.element("input",{type:"search",class:"sz-input sz-search",placeholder:"Search hidden streamers…","aria-label":"Search hidden streamers"});
    search.value=managerQuery;
    const outlet=UI.element("div",{class:"sz-manager-body"});
    const renderEntries=()=>{
      outlet.replaceChildren(UI.entries(state,async login=>{
        const entries=[...outlet.querySelectorAll("[data-login]")];
        const index=entries.findIndex(entry=>entry.dataset.login===login);
        const generation=storageGeneration;
        UI.busy(outlet,true);
        try{
          const result=await UI.request(UI.restoreRequest(state,login,managerObservations));
          if(generation===storageGeneration)applyState(result.state);
          showToast(login+" is back in your channels.",result.undo);
          if(panel?.kind==="manager"){
            const buttons=[...panel.mount.root.querySelectorAll(".sz-restore")];
            if(!panel.mount.root.activeElement?.classList.contains("sz-search"))(buttons[Math.min(index,buttons.length-1)]||panel.mount.root.querySelector(".sz-close"))?.focus();
          }
        }catch(error){UI.busy(outlet,false);UI.alert(panel?.kind==="manager"?panel.mount.container.firstElementChild:view,error);}
      },{query:managerQuery,observations:managerObservations,onWhitelist:item=>change({type:"TSNOOZE_WHITELIST_SET",login:item.login,displayName:item.displayName},item.displayName+" will always be shown.")}),UI.scopeNote());
    };
    search.addEventListener("input",()=>{managerQuery=search.value;renderEntries();});
    view.append(UI.element("p",{class:"sz-manager-intro",text:"Control what shows up on Twitch."}),switcher);
    if(managerTab==="streamers"){
      view.append(UI.element("div",{class:"sz-search-field"},UI.icon("search"),search),outlet);renderEntries();
    }else{
      outlet.append(managerTab==="whitelist"?UI.whitelist(state,{onAdd:login=>change({type:"TSNOOZE_WHITELIST_SET",login},login+" will always be shown."),onRemove:login=>change({type:"TSNOOZE_WHITELIST_REMOVE",login},login+" removed from whitelist.")}):UI.categories(state,{observations:managerObservations,onAdd:category=>change({type:"TSNOOZE_RULE_SET",category},category.name+" hidden."),onRemove:id=>change({type:"TSNOOZE_RULE_REMOVE",id},"Category restored."),onException:(id,login)=>change({type:"TSNOOZE_RULE_EXCEPTION",id,login,allow:false},"Exception removed.")}));
      view.append(outlet);
    }
    view.append(UI.element("footer",{class:"sz-manager-footer"},UI.element("span",{class:"sz-device-dot","aria-hidden":"true"}),"Saved on this device",UI.element("span",{class:"sz-key-hint",text:"Esc to close"})));
    if(draft&&current.tab===managerTab&&view.querySelector(".sz-category-form input"))view.querySelector(".sz-category-form input").value=draft;
    current.tab=managerTab;
    current.mount.container.replaceChildren(view);
    outlet.scrollTop=scrollTop;
    current.mount.ready.then(()=>{if(panel===current)locatePanel();});
    if(draftFocused)view.querySelector(".sz-category-form input")?.focus({preventScroll:true});
    else if(searching&&managerTab==="streamers"){search.focus({preventScroll:true});search.setSelectionRange(...selection);}
    else if(activeLogin)view.querySelector('[data-login="'+activeLogin+'"] .sz-restore')?.focus({preventScroll:true});
    else if(activeTab)view.querySelector('[data-tab="'+activeTab+'"]')?.focus({preventScroll:true});
  }
  function toggleManager() {
    const same=panel?.kind==="manager";closePanel();if(same)return;
    managerQuery="";managerTab="streamers";managerObservations=observations();const mount=attachPanel(manager.button,null,"manager");
    renderManagerPanel();refreshOverview();
    mount.ready.then(()=>{if(panel?.mount===mount){locatePanel();mount.root.querySelector(".sz-search")?.focus({preventScroll:true});}});
  }
  function renderManagerButton() {
    if(!manager)return;
    const counts=UI.managerCounts(state,observations()),count=counts.streamers+counts.categories;
    manager.count.textContent=String(count);manager.button.classList.toggle("compact",compact());
    manager.button.setAttribute("aria-label","Hidden Content ("+count+")");
    manager.button.title=counts.streamers+" streamers · "+counts.categories+" categories";
  }
  function ensureManager() {
    const nextNav=document.querySelector("#side-nav");
    if(nextNav!==nav){
      if(panel?.type==="sidebar")closePanel();
      manager?.mount.host.remove();manager=null;nav=nextNav;
      resizeObserver.disconnect();
      if(nav){navWidth=nav.getBoundingClientRect().width;resizeObserver.observe(nav);}
    }
    if(!nav)return;
    const section=[...nav.querySelectorAll(".side-nav-section")].find(node=>node.querySelector('[data-test-selector="followed-channel"]'))||nav.querySelector(".side-nav-section")||nav;
    if(!manager?.mount.host.isConnected){
      const mount=UI.mount("manager"),count=UI.element("span",{class:"sz-count",text:"0"});
      const button=UI.element("button",{type:"button",class:"sz-manager-button","aria-expanded":"false","aria-haspopup":"dialog",onclick:toggleManager},UI.icon("moon"),UI.element("span",{class:"sz-manager-label",text:"Hidden Content"}),count,UI.icon("chevron"));
      mount.container.append(button);manager={mount,button,count};
    }
    const {mount}=manager;
    let heading=[...section.querySelectorAll('.side-nav-header,[data-a-target="side-nav-header"],h1,h2,h3,h4,h5,h6,[role="heading"]')].find(node=>!node.closest(".side-nav-card"));
    while(heading?.parentElement&&heading.parentElement!==section&&!heading.parentElement.querySelector(".side-nav-card"))heading=heading.parentElement;
    const channelList=section.querySelector(".tw-transition-group");
    if(channelList){
      if(mount.host.parentElement!==channelList.parentElement||(mount.host.compareDocumentPosition(channelList)&Node.DOCUMENT_POSITION_PRECEDING))channelList.before(mount.host);
    }else if(heading){
      if(mount.host.previousElementSibling!==heading)heading.after(mount.host);
    }else if(mount.host.parentElement!==section)section.prepend(mount.host);
    renderManagerButton();
  }
  function ensureControls() {
    for(const [target,control] of controls){
      const info=infoFor(target,control.type);
      if(!target.isConnected||!info||info.login!==control.login||(control.type==="category"&&info.category.key!==control.categoryKey)||!control.mount.host.isConnected){
        control.mount.host.remove();controls.delete(target);
        target.removeAttribute("data-tsnz-row");target.removeAttribute("data-tsnz-card");target.removeAttribute("data-tsnz-collapsed");
        if(panel?.target===target)closePanel();
      }
    }
    const targets=sideRows().map(target=>({target,type:"sidebar"}));
    for(const target of discoveryCards())targets.push({target,type:"card"});
    for(const target of document.querySelectorAll(".game-card"))targets.push({target,type:"category"});
    for(const {target,type} of targets){
      const info=infoFor(target,type);if(!info)continue;
      if(!controls.has(target)){
        const mount=UI.mount(type!=="sidebar"?"card-control":"control");
        const button=UI.element("button",{type:"button",class:"sz-trigger"+(type!=="sidebar"?" sz-card-trigger":""),"aria-haspopup":"true","aria-expanded":"false",onclick:event=>{event.preventDefault();event.stopPropagation();showMenu(target,button,type);}},UI.icon("moon"));
        if(type!=="sidebar")button.append(UI.element("span",{text:type==="category"?"Hide":"Snooze"}));
        mount.container.append(button);target.append(mount.host);
        target.setAttribute(type!=="sidebar"?"data-tsnz-card":"data-tsnz-row","");
        controls.set(target,{mount,button,type,login:info.login,categoryKey:info.category?.key});
      }
      const control=controls.get(target),label=(type==="category"?"Hide category ":"Snooze ")+info.displayName;
      control.button.setAttribute("aria-label",label);control.button.title=label;
      if(type==="sidebar"){
        if(compact())target.setAttribute("data-tsnz-collapsed","");else target.removeAttribute("data-tsnz-collapsed");
        control.button.classList.toggle("sz-trigger-compact",compact());
      }
    }
  }
  function scan() {
    scanTimer=null;if(stopped)return;
    state=Core.normalizeState(state);ensureManager();ensureControls();applyFilters();renderManagerButton();
    if(panel?.kind==="menu"&&(!panel.target.isConnected||infoFor(panel.target,panel.type)?.login!==panel.login||infoFor(panel.target,panel.type)?.category?.key!==panel.categoryKey||panel.target.closest('[data-tsnz-hidden="true"]')))closePanel();
    if(panel?.kind==="manager"&&!panel.mount.host.isConnected)closePanel();
    locatePanel();
  }
  function scheduleScan() {if(!stopped&&scanTimer===null)scanTimer=setTimeout(scan,60);}
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    const next=Math.min(...Object.values(state.snoozes).map(item=>item.until));
    if(Number.isFinite(next))expiryTimer=setTimeout(()=>{state=Core.normalizeState(state);scan();renderManagerPanel();scheduleExpiry();refresh();},Math.min(2147483000,Math.max(20,next-Date.now()+20)));
  }
  function applyState(next,authoritative=false) {
    if(stopped||!next||(!authoritative&&Number(next.revision)<state.revision))return;
    state=Core.normalizeState(next);scan();renderManagerPanel();scheduleExpiry();refreshOverview();
  }
  function showToast(text,undo) {
    clearTimeout(toastTimer);toast?.host.remove();
    const current=UI.mount("toast");toast=current;
    const view=UI.element("div",{class:"sz-toast",role:"status","aria-live":"polite"},UI.icon("check"),UI.element("span",{class:"sz-toast-text",text}));
    if(undo)view.append(UI.element("button",{type:"button",class:"sz-undo",onclick:async()=>{
      UI.busy(view,true);const generation=storageGeneration;
      try{const result=await UI.request({type:"TSNOOZE_UNDO",undo});if(generation===storageGeneration)applyState(result.state);showToast("Snooze change undone.");}
      catch(error){UI.busy(view,false);view.querySelector(".sz-toast-text").textContent=error.message;}
    }},"Undo"));
    current.container.append(view);document.body.append(current.host);
    toastTimer=setTimeout(()=>{current.host.remove();if(toast===current)toast=null;},20000);
  }
  async function refresh() {
    const generation=storageGeneration;
    try{await UI.request({type:"TSNOOZE_REGISTER"});const result=await UI.request({type:"TSNOOZE_GET"});if(generation===storageGeneration)applyState(result.state);}
    catch(error){if(/context invalidated|was updated/i.test(String(error)))cleanup();}
  }
  function cleanup() {
    stopped=true;observer.disconnect();themeObserver.disconnect();resizeObserver.disconnect();
    clearTimeout(scanTimer);clearTimeout(expiryTimer);clearTimeout(toastTimer);clearInterval(overviewTimer);closePanel();toast?.host.remove();manager?.mount.host.remove();
    for(const [target,control] of controls){control.mount.host.remove();target.removeAttribute("data-tsnz-row");target.removeAttribute("data-tsnz-card");target.removeAttribute("data-tsnz-collapsed");}
    for(const node of hiddenNodes)node.removeAttribute("data-tsnz-hidden");
    controls.clear();hiddenNodes.clear();
  }
  const observer=new MutationObserver(records=>{
    const targets='#side-nav,.side-nav-card,article,.preview-card,.game-card,[data-target="directory-game__card_container"]';
    if(records.some(record=>{
      const target=record.target.nodeType===Node.TEXT_NODE?record.target.parentElement:record.target;
      if(target?.closest?.(targets)&&!target.closest?.("twitch-snooze-ui"))return true;
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.hasAttribute("data-tsnz-owned")&&(node.matches(targets)||node.querySelector(targets)));
    }))scheduleScan();
  });
  const themeObserver=new MutationObserver(()=>{for(const host of document.querySelectorAll("twitch-snooze-ui"))host.dataset.theme=UI.theme();});
  const resizeObserver=new ResizeObserver(()=>{
    const width=nav?.getBoundingClientRect().width||0;
    if(Math.abs(width-navWidth)>.5){navWidth=width;if(panel?.type==="sidebar"&&panel.kind!=="manager")closePanel();scheduleScan();}
  });
  observer.observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:["href","title"]});
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class"]});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(stopped||area!=="local"||!changes[Core.STORAGE_KEY])return;
    storageGeneration++;applyState(Core.normalizeState(changes[Core.STORAGE_KEY].newValue),true);
  });
  document.addEventListener("click",event=>{
    if(!panel)return;
    if(event.composedPath().some(node=>node===panel.mount.host||node===panel.trigger||node===panel.trigger.getRootNode().host))return;
    closePanel();
  });
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&panel){event.preventDefault();closePanel(true);}});
  document.addEventListener("scroll",locatePanel,true);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!stopped){scan();renderManagerPanel();refresh();}});
  window.addEventListener("pageshow",refresh);window.addEventListener("resize",scheduleScan);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{if(sender.id===chrome.runtime.id&&message?.type==="TSNOOZE_SNAPSHOT"){sendResponse({items:observations()});}return false;});
  const overviewTimer=setInterval(()=>{if(!document.hidden)refreshOverview();},2500);
  scan();refresh();
})();
