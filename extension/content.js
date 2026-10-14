(() => {
  "use strict";
  if (globalThis.__twitchSnoozeLoaded) return;
  globalThis.__twitchSnoozeLoaded = true;
  const Core=globalThis.TwitchSnooze, UI=globalThis.TwitchSnoozeUI, t=UI.t;
  const controls=new Map(), hiddenNodes=new Set(), peekNodes=new Set(), chips=new Map(), learnedSent=new Set();
  let referencedCache=null;
  const CARD_LINKS='a[data-a-target="preview-card-channel-link"][href],a[data-a-target="preview-card-image-link"][href]';
  const CATEGORY_LINKS='a[href^="/directory/category/"],a[href^="/directory/game/"]';
  const SEARCH_MARKERS='[data-a-target="search-result-live-channel"],[data-test-selector="search-result-offline-channel__name"],[data-a-target="search-result-video"],[data-a-target="search-result-category"]';
  const FEATURED='[data-a-target="front-page-carousel"] [data-a-target="featured-item"]';
  const STREAM_TYPES=new Set(["sidebar","card","search","featured"]), CHIP_TYPES=new Set(["card","category","search","search-category","featured"]);
  let state=Core.normalizeState(), view={peek:false}, panel=null, manager=null, toast=null, page={items:[],info:new Map()};
  let scanTimer=null, expiryTimer=null, toastTimer=null, nav=null, navWidth=0, isCompact=false, unnamed=null, skip={count:0,at:0};
  let stopped=false, storageGeneration=0, managerQuery="", managerTab="streamers", managerObservations=[], overviewPending=false;

  function sideRows(){return [...document.querySelectorAll(".side-nav-card")].filter(row=>!row.parentElement?.closest(".side-nav-card"));}
  function text(node){return node?.getAttribute("title")||node?.textContent?.trim()||"";}
  function linkCategory(link){return link?Core.normalizeCategory({name:link.textContent.trim()||link.getAttribute("title")||"",slug:Core.categorySlugFromHref(link.getAttribute("href"))}):null;}
  function tagsIn(node){
    const tags=[];
    for(const tag of node.querySelectorAll(".tw-tag,[aria-label^='Tag, ']")){
      const value=(tag.getAttribute("aria-label")||"").replace(/^Tag,\s*/,"")||tag.textContent.trim();
      if(value&&!tags.includes(value)&&tags.length<12)tags.push(value.slice(0,60));
    }
    return tags;
  }
  // Twitch draws only the tags that fit, so a card we've hidden (no width) shows none and would flicker back.
  // Keep the tags seen for the same card, streamer and title.
  const tagMemory=new WeakMap();
  function withText(info,title,node){
    title=(title||"").slice(0,300);
    const seen=tagsIn(node),memo=tagMemory.get(node);
    let tags=seen;
    if(memo&&memo.login===info.login&&memo.title===title){tags=[...new Set([...seen,...memo.tags])].slice(0,12);memo.tags=tags;}
    else tagMemory.set(node,{login:info.login,title,tags:seen});
    if(title)info.title=title;if(tags.length)info.tags=tags;return info;
  }
  function categoryInfo(node,type){
    if(type==="sidebar"){const label=node.querySelector('.side-nav-card__metadata p,[data-a-target="side-nav-game-title"],.side-nav-card-metadata .game');return Core.normalizeCategory(label?.textContent?.trim()||label?.getAttribute("title"));}
    if(type==="category"){
      const label=node.querySelector('[data-a-target="tw-card-title"] h2');
      const link=node.querySelector('a[data-a-target="tw-box-art-card-link"]')||node.querySelector(CATEGORY_LINKS);
      return Core.normalizeCategory({name:label?.textContent?.trim()||label?.getAttribute("title")||"",slug:Core.categorySlugFromHref(link?.getAttribute("href"))});
    }
    return linkCategory(node.querySelector('a[data-a-target="preview-card-game-link"]'));
  }
  // The streamer's profile picture: the avatar linked to their channel, or the only avatar in the item.
  // Group streams show several avatars without links, so those are skipped. Stream thumbnails never qualify.
  function avatarIn(node,login){
    const images=[...new Set(node.querySelectorAll("img.tw-image-avatar,.tw-avatar img"))];
    const linked=images.filter(image=>Core.normalizeLogin(image.closest("a[href]")?.getAttribute("href"))===login);
    const image=linked.length===1?linked[0]:!linked.length&&images.length===1?images[0]:null;
    return image?Core.normalizeAvatar(image.getAttribute("src")):null;
  }
  const withAvatar=(info,node)=>{const avatar=avatarIn(node,info.login);if(avatar)info.avatar=avatar;return info;};
  function channelInfo(row) {
    const link=row.querySelector('a.side-nav-card__link[href],a.side-nav-card[href]');
    const login=Core.normalizeLogin(link?.getAttribute("href"));
    if(!login)return null;
    // Group streams have no title element and their first avatar may name a guest, so prefer Twitch's name label.
    const label=row.querySelector('[data-a-target="side-nav-title"]')||row.querySelector('[data-a-target="side-nav-card-metadata"] p[title]');
    const name=label?(label.textContent.trim()||label.getAttribute("title")):"";
    return withAvatar({login,displayName:Core.normalizeDisplayName(name||link.querySelector("img")?.alt,login),nameReliable:Boolean(name),category:categoryInfo(row,"sidebar")},row);
  }
  function cardInfo(card) {
    const link=card.querySelector('a[data-a-target="preview-card-channel-link"][href]') || card.querySelector('a[data-a-target="preview-card-image-link"][href]');
    const login=Core.normalizeLogin(link?.getAttribute("href"));
    if(!login)return null;
    const label=card.querySelector('a[data-a-target="preview-card-channel-link"] p[title]')||card.querySelector('a[data-a-target="preview-card-channel-link"] p');
    const name=label?.getAttribute("title")||[...(label?.childNodes||[])].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join("");
    const title=text(card.querySelector('a[data-a-target="preview-card-channel-link"] h4[title],a[data-a-target="preview-card-title-link"] [title],h3[title],h4[title]'));
    return withText(withAvatar({login,displayName:Core.normalizeDisplayName(name,login),nameReliable:Boolean(name),category:categoryInfo(card,"card")},card),title,card);
  }
  function tileInfo(tile){const category=categoryInfo(tile,"category");return category?{login:null,displayName:category.name,category}:null;}
  // Search results: live channels, offline channels and past videos each have their own markup.
  function searchInfo(row){
    const live=row.matches('[data-a-target="search-result-live-channel"]')?row:row.querySelector('[data-a-target="search-result-live-channel"]');
    if(live){
      const link=live.querySelector('[data-test-selector="search-result-live-channel__name"] a[href]');
      const login=Core.normalizeLogin(link?.getAttribute("href"));
      if(!login)return null;
      const name=link.textContent.trim();
      return withText({login,displayName:Core.normalizeDisplayName(name,login),nameReliable:Boolean(name),category:linkCategory(live.querySelector('[data-test-selector="search-result-live-channel__category"] a[href]'))},
        text(live.querySelector('[data-test-selector="search-result-live-channel__title"]')),row);
    }
    const video=row.matches('[data-a-target="search-result-video"]')?row:row.querySelector('[data-a-target="search-result-video"]');
    if(video){
      const href=video.querySelector('a[href*="/video/"]')?.getAttribute("href")||"";
      const login=Core.normalizeLogin(/^\/([a-z0-9_]{1,25})\/video\//i.exec(href)?.[1]||"");
      if(!login)return null;
      const name=video.querySelector("p[title]")?.getAttribute("title")||"";
      return withText({login,displayName:Core.normalizeDisplayName(name,login),nameReliable:Boolean(name),category:linkCategory(video.querySelector(CATEGORY_LINKS))},
        video.querySelector("strong a")?.textContent.trim()||"",video);
    }
    const offline=row.querySelector('[data-test-selector="search-result-offline-channel__name"] a[href]')||(row.matches('[data-test-selector="search-result-offline-channel__name"]')?row.querySelector("a[href]"):null);
    const login=Core.normalizeLogin(offline?.getAttribute("href"));
    if(!login)return null;
    const name=offline.textContent.trim();
    return withAvatar({login,displayName:Core.normalizeDisplayName(name,login),nameReliable:Boolean(name),category:null},row);
  }
  function searchCategoryInfo(row){const category=linkCategory(row.querySelector('[data-test-selector="search-result-category__name"] a[href]'));return category?{login:null,displayName:category.name,category}:null;}
  function featuredInfo(item){
    const name=item.querySelector('[data-a-target="carousel-display-name"]');
    const login=Core.normalizeLogin(name?.closest("a[href]")?.getAttribute("href"));
    if(!login)return null;
    const label=name.getAttribute("title")||name.textContent.trim();
    return withText(withAvatar({login,displayName:Core.normalizeDisplayName(label,login),nameReliable:Boolean(label),category:linkCategory(item.querySelector(CATEGORY_LINKS))},item),
      text(item.querySelector('[data-test-selector="carousel-title"]')),item);
  }
  function infoFor(node,type){
    if(page.info.has(node))return page.info.get(node);
    return type==="category"?tileInfo(node):type==="card"?cardInfo(node):type==="search"?searchInfo(node):type==="search-category"?searchCategoryInfo(node):type==="featured"?featuredInfo(node):channelInfo(node);
  }
  function discoveryCards() {
    const cards=new Set();
    for(const link of document.querySelectorAll(CARD_LINKS)){
      const card=link.closest('article,.preview-card,[data-target="directory-game__card_container"]');
      if(card&&!card.closest('[data-a-target="front-page-carousel"]'))cards.add(card);
    }
    return cards;
  }
  function resultRow(marker){
    let node=marker;
    for(let depth=0;depth<5&&node.parentElement&&node.parentElement!==document.body;depth++){
      const parent=node.parentElement;
      if(parent.querySelectorAll(SEARCH_MARKERS).length!==1||parent.querySelector('h1,h2,h3,[data-test-selector^="search-results__show-more"]'))break;
      node=parent;
    }
    return node;
  }
  // Read every supported row and card once per scan; the rest of the scan works from this snapshot.
  function readPage() {
    const items=[];
    for(const target of sideRows())items.push({target,type:"sidebar",info:channelInfo(target)});
    for(const target of discoveryCards())items.push({target,type:"card",info:cardInfo(target)});
    for(const target of document.querySelectorAll(".game-card"))items.push({target,type:"category",info:tileInfo(target)});
    const rows=new Set();
    for(const marker of document.querySelectorAll(SEARCH_MARKERS)){
      const row=resultRow(marker);
      if(rows.has(row))continue;
      rows.add(row);
      const isCategory=marker.matches('[data-a-target="search-result-category"]');
      items.push({target:row,type:isCategory?"search-category":"search",info:isCategory?searchCategoryInfo(row):searchInfo(row)});
    }
    const featured=document.querySelector(FEATURED);
    if(featured)items.push({target:featured,type:"featured",info:featuredInfo(featured)});
    const slugs=new Map(), known=new Map(), cards=new Map();
    for(const {type,info} of items){
      if(!info)continue;
      if(info.category?.slug)slugs.set(info.category.key,info.category.slug);
      if(!info.login)continue;
      if(info.category){const previous=known.get(info.login);known.set(info.login,known.has(info.login)&&previous?.key!==info.category.key?null:info.category);}
      if(type!=="sidebar"&&info.title)cards.set(info.login,cards.has(info.login)&&cards.get(info.login)?.category?.key!==info.category?.key?null:info);
    }
    for(const item of items){
      const info=item.info;
      if(!info?.login){item.effective=info;continue;}
      let category=info.category||known.get(info.login)||null;
      // Sidebar text has no link, so borrow the language-independent slug from a card or tile on the same page.
      if(category&&!category.slug&&slugs.has(category.key))category={...category,slug:slugs.get(category.key)};
      const effective={...info,category};
      const card=item.type==="sidebar"?cards.get(info.login):null;
      if(card&&(!info.category||!card.category||card.category.key===info.category.key)){if(card.title)effective.title=card.title;if(card.tags)effective.tags=card.tags;}
      item.effective=effective;
    }
    return {items,info:new Map(items.map(item=>[item.target,item.info]))};
  }
  function observations(){return page.items.filter(item=>STREAM_TYPES.has(item.type)&&item.info).map(({info})=>{const {nameReliable,...rest}=info;return rest;});}
  async function refreshOverview(){
    if(stopped||overviewPending||panel?.kind!=="manager")return;
    overviewPending=true;
    try{const result=await UI.request({type:"TSNOOZE_OVERVIEW"});const next=result.observations||[];if(JSON.stringify(next)!==JSON.stringify(managerObservations)){managerObservations=next;if(managerTab!=="categories")renderManagerPanel();}}
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
  function setMark(node,attribute,set,on) {
    if(on){if(node.getAttribute(attribute)!=="true")node.setAttribute(attribute,"true");set.add(node);}
    else{node.removeAttribute(attribute);set.delete(node);}
  }
  function hiddenCategory(category,rules){return rules.some(rule=>Core.categoryMatches(rule,category));}
  function skipFeatured(){
    // Move Twitch's homepage carousel on to the next featured stream instead of playing someone you hid.
    const next=document.querySelector('[data-a-target="front-page-carousel"] [data-a-target="featured-item-right-button"]');
    if(!next||skip.count>=6||Date.now()-skip.at<500)return skip.count>=6;
    skip.count++;skip.at=Date.now();
    setTimeout(()=>{if(!stopped)next.click();},0);
    // Check again even if the carousel doesn't change, so a stuck carousel is removed after a few tries.
    setTimeout(scheduleScan,700);
    return false;
  }
  function applyFilters() {
    const hide=new Set(), fade=new Map();
    const categoryRules=Object.values(state.rules).filter(rule=>rule.login===null);
    let featuredHidden=false;
    for(const item of page.items){
      if(!item.effective)continue;
      let reasons;
      if(item.type==="category"||item.type==="search-category")reasons=hiddenCategory(item.effective.category,categoryRules)?[t("reasonCategory",{category:item.effective.category.name})]:[];
      else reasons=UI.reasonTextsFor(Core.hiddenReasons(state,item.effective));
      if(!reasons.length)continue;
      const node=item.type==="card"||item.type==="category"?gridItem(item.target):item.target;
      if(view.peek){fade.set(node,{target:item.target,type:item.type,reasons});continue;}
      if(item.type==="featured"){featuredHidden=true;if(skipFeatured()){const carousel=item.target.closest('[data-a-target="front-page-carousel"]');if(carousel)hide.add(carousel);}continue;}
      hide.add(node);
    }
    if(!featuredHidden)skip.count=0;
    for(const node of hiddenNodes)if(!hide.has(node))setMark(node,"data-tsnz-hidden",hiddenNodes,false);
    for(const node of hide)setMark(node,"data-tsnz-hidden",hiddenNodes,true);
    for(const node of peekNodes)if(!fade.has(node))setMark(node,"data-tsnz-peek",peekNodes,false);
    const chipTargets=new Map();
    for(const [node,entry] of fade){setMark(node,"data-tsnz-peek",peekNodes,true);if(CHIP_TYPES.has(entry.type))chipTargets.set(entry.target,entry.reasons);}
    for(const [target,chip] of chips)if(!chipTargets.has(target)||!chip.host.isConnected){chip.host.remove();chips.delete(target);}
    for(const [target,reasons] of chipTargets){
      const key=reasons.join("\n");
      let chip=chips.get(target);
      if(!chip){chip=UI.mount("peek-chip");target.append(chip.host);chips.set(target,chip);if(!target.hasAttribute("data-tsnz-card"))target.setAttribute("data-tsnz-card","");}
      if(chip.key!==key){chip.key=key;chip.container.replaceChildren(UI.peekChip(reasons));}
    }
  }
  function unnamedLogins(){
    if(unnamed?.state===state)return unnamed.logins;
    const logins=new Set(),add=record=>{if(record?.login&&record.displayName===record.login)logins.add(record.login);};
    Object.values(state.snoozes).forEach(add);Object.values(state.whitelist).forEach(add);
    for(const rule of Object.values(state.rules)){if(rule.login)add(rule);rule.exceptions.forEach(add);}
    for(const filter of Object.values(state.filters))filter.exceptions.forEach(add);
    unnamed={state,logins};return logins;
  }
  function referenced(){
    if(referencedCache?.state!==state)referencedCache={state,logins:Core.referencedLogins(state)};
    return referencedCache.logins;
  }
  // Fill in real display names, profile pictures and category links for saved rules; only sends when something is missing or changed.
  function learnFromPage(){
    const names=[],categories=[],logins=unnamedLogins(),known=referenced(),rules=Object.values(state.rules);
    for(const {info} of page.items){
      if(!info)continue;
      if(info.login&&info.nameReliable&&logins.has(info.login)&&info.displayName!==info.login){const key="n:"+info.login+":"+info.displayName;if(!learnedSent.has(key)){learnedSent.add(key);names.push({login:info.login,displayName:info.displayName});}}
      if(info.login&&info.avatar&&known.has(info.login)&&Core.avatarFor(state,info.login)!==info.avatar){const key="a:"+info.login+":"+info.avatar;if(!learnedSent.has(key)){learnedSent.add(key);names.push({login:info.login,displayName:info.nameReliable?info.displayName:info.login,avatar:info.avatar});}}
      const category=info.category;
      if(!category?.slug)continue;
      const needed=rules.some(rule=>rule.category.slug?rule.category.slug===category.slug&&rule.category.key!==category.key&&!(rule.aliases||[]).includes(category.key):rule.category.key===category.key||(rule.aliases||[]).includes(category.key));
      const key="c:"+category.slug+":"+category.key;
      if(needed&&!learnedSent.has(key)){learnedSent.add(key);categories.push(category);}
    }
    if(names.length||categories.length)UI.request({type:"TSNOOZE_LEARN",names,categories}).catch(()=>{});
  }
  function closePanel(restoreFocus=false) {
    if(!panel)return;
    const previous=panel;panel=null;previous.mount.host.remove();
    for(const control of controls.values())control.button.setAttribute("aria-expanded","false");
    manager?.button.setAttribute("aria-expanded","false");
    if(restoreFocus&&previous.trigger?.isConnected)previous.trigger.focus();
  }
  function locatePanel() {
    if(!panel)return;
    const {mount,trigger}=panel;
    if(!trigger.isConnected){closePanel();return;}
    const rect=trigger.getBoundingClientRect();
    if(rect.bottom<0||rect.top>innerHeight){closePanel();return;}
    const width=Math.min(panel.kind==="manager"?440:300,Math.max(0,innerWidth-20));
    mount.host.style.width=width+"px";
    mount.host.style.left=Math.max(10,Math.min(rect.right+(panel.kind==="manager"?12:8),innerWidth-width-10))+"px";
    mount.host.style.top=Math.max(10,Math.min(rect.top-(panel.kind==="manager"?0:6),innerHeight-mount.host.getBoundingClientRect().height-10))+"px";
  }
  function attachPanel(trigger,target,kind,type="sidebar") {
    const mount=UI.mount(kind==="manager"?"manager-panel":"floating");
    document.body.append(mount.host);
    panel={mount,trigger,target,kind,type,floating:true};
    trigger.setAttribute("aria-expanded","true");
    return mount;
  }
  function focusMenu(mount,menuView) {
    if(panel?.mount!==mount||!menuView.isConnected)return;
    locatePanel();
    (menuView.querySelector(".sz-show-now")||menuView.querySelector(".sz-duration.default")||menuView.querySelector(".sz-whitelist-action")||menuView.querySelector(".sz-rule-action"))?.focus({preventScroll:true});
  }
  async function act(viewNode,message,text,mount){
    UI.busy(viewNode,true);const generation=storageGeneration;
    try{
      const result=await UI.request(message);
      if(generation===storageGeneration)applyState(result.state);
      if(mount&&panel?.mount===mount)closePanel();
      showToast(text,result.undo);
      if(!panel)manager?.button.focus({preventScroll:true});
      return result;
    }catch(error){UI.busy(viewNode,false);UI.alert(viewNode,error);return null;}
  }
  function showMenu(target,trigger,type) {
    const info=infoFor(target,type);
    if(!info)return;
    const same=panel?.kind==="menu"&&panel?.target===target;
    closePanel();if(same)return;
    const effective=page.items.find(item=>item.target===target)?.effective||info;
    const mount=attachPanel(trigger,target,"menu",type);panel.login=info.login;panel.categoryKey=info.category?.key;
    const onClose=()=>closePanel(true);
    let menuView;
    if(type==="category"||type==="search-category"){
      menuView=UI.categoryMenu(info.category,{onClose,onHide:()=>act(menuView,{type:"TSNOOZE_RULE_SET",category:info.category},t("toastCategoryHidden",{category:info.category.name}),mount)});
    }else{
      const name=info.displayName;
      const reasons=Core.hiddenReasons(state,effective);
      const snooze=duration=>act(menuView,{type:"TSNOOZE_SET",login:info.login,displayName:name,duration},Core.snoozedMessage(name,duration),mount);
      if(reasons.length){
        menuView=UI.hiddenMenu(info.login,name,UI.reasonTextsFor(reasons),{onClose,snoozed:reasons.some(reason=>reason.type==="snooze"),onSelect:snooze,
          onShow:()=>act(menuView,UI.restoreRequest(state,info.login,[effective,...observations()]),t("toastBack",{name}),mount)});
      }else{
        menuView=UI.menu(info.login,name,snooze,onClose,{category:info.category,whitelisted:Core.isWhitelisted(state,info.login),
          onRule:scope=>act(menuView,{type:"TSNOOZE_RULE_SET",category:info.category,...(scope==="channel"?{login:info.login,displayName:name}:{})},scope==="channel"?t("toastWhilePlaying",{name,category:info.category.name}):t("toastCategoryHidden",{category:info.category.name}),mount),
          onWhitelist:allow=>act(menuView,{type:allow?"TSNOOZE_WHITELIST_SET":"TSNOOZE_WHITELIST_REMOVE",login:info.login,displayName:name},allow?t("toastAlwaysShow",{name}):t("toastStopAlways",{name}),mount)});
      }
    }
    mount.container.replaceChildren(menuView);focusMenu(mount,menuView);
  }
  function setPeek(next){
    try{chrome.storage.local.set({[Core.VIEW_KEY]:{peek:Boolean(next)}});}catch(_){}
    view={peek:Boolean(next)};scan();renderManagerPanel();showToast(next?t("toastPeekOn"):t("toastPeekOff"));
  }
  function renderManagerPanel() {
    if(panel?.kind!=="manager")return;
    const current=panel, active=current.mount.root.activeElement;
    const activeTab=active?.dataset.tab;
    const scrollTop=current.tab===managerTab?current.mount.root.querySelector(".sz-manager-body")?.scrollTop||0:0;
    const activeLogin=active?.closest("[data-login]")?.dataset.login;
    const searching=active?.classList.contains("sz-search");
    const peekFocused=active?.classList.contains("sz-peek-toggle");
    const selection=searching?[active.selectionStart,active.selectionEnd]:null;
    const draft=current.mount.root.querySelector(".sz-category-form input")?.value;
    const draftFocused=active?.closest(".sz-category-form");
    const box=UI.element("section",{class:"sz-panel sz-manager-panel",role:"dialog","aria-label":t("managerTitle"),"aria-modal":"false"},UI.managerHeader(()=>closePanel(true),{peek:view.peek,onPeek:setPeek}));
    const clears={TSNOOZE_WHITELIST_SET:"whitelist",TSNOOZE_RULE_SET:"categories",TSNOOZE_FILTER_SET:"keywords"};
    const change=async(message,text)=>{UI.busy(box,true);const generation=storageGeneration;try{const result=await UI.request(message);
      if(panel===current&&clears[message.type]===managerTab){const savedInput=current.mount.root.querySelector(".sz-category-form input");if(savedInput)savedInput.value="";}
      if(generation===storageGeneration)applyState(result.state);showToast(text,result.undo);}catch(error){UI.busy(box,false);UI.alert(box,error);}};
    const switcher=UI.tabs(managerTab,tab=>{managerTab=tab;renderManagerPanel();},UI.managerCounts(state,managerObservations));
    const search=UI.element("input",{type:"search",class:"sz-search",placeholder:t("searchStreamers"),"aria-label":t("searchStreamers")});
    search.value=managerQuery;
    const outlet=UI.element("div",{class:"sz-manager-body"});
    const nameFor=login=>managerObservations.find(info=>info.login===login)?.displayName||login;
    const renderEntries=()=>{
      outlet.replaceChildren(UI.entries(state,async (login,item)=>{
        const rows=[...outlet.querySelectorAll("[data-login]")];
        const index=rows.findIndex(entry=>entry.dataset.login===login);
        const generation=storageGeneration;
        UI.busy(outlet,true);
        try{
          const result=await UI.request(UI.restoreRequest(state,login,managerObservations));
          if(generation===storageGeneration)applyState(result.state);
          showToast(t("toastBack",{name:item?.displayName||login}),result.undo);
          if(panel?.kind==="manager"){
            const buttons=[...panel.mount.root.querySelectorAll(".sz-restore")];
            if(!panel.mount.root.activeElement?.classList.contains("sz-search"))(buttons[Math.min(index,buttons.length-1)]||panel.mount.root.querySelector(".sz-close"))?.focus();
          }
        }catch(error){UI.busy(outlet,false);UI.alert(panel?.kind==="manager"?panel.mount.container.firstElementChild:box,error);}
      },{query:managerQuery,observations:managerObservations,
        onChange:(login,duration,item)=>change({type:"TSNOOZE_SET",login,displayName:item.displayName,duration},Core.snoozedMessage(item.displayName,duration)),
        onWhitelist:item=>change({type:"TSNOOZE_WHITELIST_SET",login:item.login,displayName:item.displayName},t("toastAlwaysShow",{name:item.displayName}))}));
    };
    search.addEventListener("input",()=>{managerQuery=search.value;renderEntries();});
    box.append(switcher);
    if(managerTab==="streamers"){
      box.append(UI.element("label",{class:"sz-search-field"},UI.icon("search"),search),outlet);renderEntries();
    }else{
      if(managerTab==="whitelist")outlet.append(UI.whitelist(state,{observations:managerObservations,onAdd:login=>change({type:"TSNOOZE_WHITELIST_SET",login,displayName:nameFor(login)},t("toastAlwaysShow",{name:nameFor(login)})),onRemove:(login,item)=>change({type:"TSNOOZE_WHITELIST_REMOVE",login},t("toastStopAlways",{name:item?.displayName||login}))}));
      else if(managerTab==="keywords")outlet.append(UI.keywords(state,{observations:managerObservations,onAdd:keyword=>change({type:"TSNOOZE_FILTER_SET",text:keyword},t("toastKeywordAdded",{keyword})),onRemove:(id,filter)=>change({type:"TSNOOZE_FILTER_REMOVE",id},t("toastKeywordRemoved",{keyword:filter.text})),onException:(id,login)=>change({type:"TSNOOZE_FILTER_EXCEPTION",id,login,allow:false},t("toastExceptionRemoved"))}));
      else outlet.append(UI.categories(state,{observations:managerObservations,onAdd:category=>change({type:"TSNOOZE_RULE_SET",category},t("toastCategoryAdded",{category:category.name})),onRemove:(id,rule)=>change({type:"TSNOOZE_RULE_REMOVE",id},t("toastCategoryShown",{category:rule.category.name})),onException:(id,login)=>change({type:"TSNOOZE_RULE_EXCEPTION",id,login,allow:false},t("toastExceptionRemoved"))}));
      box.append(outlet);
    }
    box.append(UI.managerFooter(()=>UI.request({type:"TSNOOZE_OPEN_BACKUP"}).catch(error=>UI.alert(box,error))));
    if(draft&&current.tab===managerTab&&box.querySelector(".sz-category-form input"))box.querySelector(".sz-category-form input").value=draft;
    current.tab=managerTab;
    current.mount.container.replaceChildren(box);
    outlet.scrollTop=scrollTop;
    locatePanel();
    if(draftFocused)box.querySelector(".sz-category-form input")?.focus({preventScroll:true});
    else if(searching&&managerTab==="streamers"){search.focus({preventScroll:true});search.setSelectionRange(...selection);}
    else if(peekFocused)box.querySelector(".sz-peek-toggle")?.focus({preventScroll:true});
    else if(activeLogin)box.querySelector('[data-login="'+CSS.escape(activeLogin)+'"] .sz-restore')?.focus({preventScroll:true});
    else if(activeTab)box.querySelector('[data-tab="'+CSS.escape(activeTab)+'"]')?.focus({preventScroll:true});
  }
  function toggleManager() {
    const same=panel?.kind==="manager";closePanel();if(same)return;
    managerQuery="";managerTab="streamers";managerObservations=observations();attachPanel(manager.button,null,"manager");
    renderManagerPanel();refreshOverview();
    panel.mount.root.querySelector(".sz-search")?.focus({preventScroll:true});
  }
  function renderManagerButton() {
    if(!manager)return;
    const counts=UI.managerCounts(state,observations()),count=counts.streamers+counts.categories+counts.keywords;
    if(manager.count.textContent!==String(count))manager.count.textContent=String(count);
    manager.button.classList.toggle("compact",isCompact);
    manager.button.setAttribute("aria-label",t("managerButtonAria",{count}));
    manager.button.title=t("managerButtonTitle");
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
      const mount=UI.mount("manager"),count=UI.element("span",{class:"sz-manager-count sz-count",text:"0"});
      const button=UI.element("button",{type:"button",class:"sz-manager-button","aria-expanded":"false","aria-haspopup":"dialog",onclick:toggleManager},UI.icon("moon"),UI.element("span",{class:"sz-manager-label",text:t("managerButton")}),count);
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
  }
  function ensureControls() {
    for(const [target,control] of controls){
      const info=page.info.get(target);
      if(!target.isConnected||!info||info.login!==control.login||((control.type==="category"||control.type==="search-category")&&info.category.key!==control.categoryKey)||!control.mount.host.isConnected){
        control.mount.host.remove();controls.delete(target);
        target.removeAttribute("data-tsnz-row");if(!chips.has(target))target.removeAttribute("data-tsnz-card");target.removeAttribute("data-tsnz-collapsed");
        if(panel?.target===target)closePanel();
      }
    }
    for(const {target,type,info} of page.items){
      if(!info)continue;
      const isCategory=type==="category"||type==="search-category";
      if(!controls.has(target)){
        const mount=UI.mount(type!=="sidebar"?"card-control":"control");
        const button=UI.element("button",{type:"button",class:"sz-trigger"+(type!=="sidebar"?" sz-card-trigger":""),"aria-haspopup":"true","aria-expanded":"false",onclick:event=>{event.preventDefault();event.stopPropagation();showMenu(target,button,type);}},UI.icon("moon"));
        if(type!=="sidebar")button.append(UI.element("span",{text:isCategory?t("tileHide"):t("cardSnooze")}));
        mount.container.append(button);target.append(mount.host);
        target.setAttribute(type!=="sidebar"?"data-tsnz-card":"data-tsnz-row","");
        controls.set(target,{mount,button,type,login:info.login,categoryKey:info.category?.key,label:""});
      }
      const control=controls.get(target),label=isCategory?t("triggerHideCategory",{category:info.displayName}):t("triggerSnooze",{name:info.displayName});
      if(control.label!==label){control.label=label;control.button.setAttribute("aria-label",label);control.button.title=label;}
      if(type==="sidebar"&&control.compact!==isCompact){
        control.compact=isCompact;
        if(isCompact)target.setAttribute("data-tsnz-collapsed","");else target.removeAttribute("data-tsnz-collapsed");
        control.button.classList.toggle("sz-trigger-compact",isCompact);
      }
    }
  }
  function hasExpired(){const now=Date.now();return Object.values(state.snoozes).some(entry=>entry.until!==null&&entry.until<=now);}
  function scan() {
    scanTimer=null;if(stopped)return;
    if(hasExpired())state=Core.normalizeState(state);
    ensureManager();
    isCompact=compact();
    page=readPage();
    ensureControls();applyFilters();renderManagerButton();learnFromPage();
    if(panel?.kind==="menu"){const info=panel.target.isConnected?page.info.get(panel.target)||infoFor(panel.target,panel.type):null;if(!info||info.login!==panel.login||info.category?.key!==panel.categoryKey||panel.target.closest('[data-tsnz-hidden="true"]'))closePanel();}
    if(panel?.kind==="manager"&&!panel.mount.host.isConnected)closePanel();
    locatePanel();
  }
  function scheduleScan() {if(!stopped&&scanTimer===null)scanTimer=setTimeout(scan,60);}
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    const next=Math.min(...Object.values(state.snoozes).map(item=>item.until).filter(until=>until!==null));
    if(Number.isFinite(next))expiryTimer=setTimeout(()=>{state=Core.normalizeState(state);scan();renderManagerPanel();scheduleExpiry();refresh();},Math.min(2147483000,Math.max(20,next-Date.now()+20)));
  }
  function applyState(next,authoritative=false) {
    if(stopped||!next||(!authoritative&&Number(next.revision)<state.revision))return;
    state=Core.normalizeState(next);scan();renderManagerPanel();scheduleExpiry();refreshOverview();
  }
  function showToast(message,undo) {
    clearTimeout(toastTimer);toast?.host.remove();
    const current=UI.mount("toast");toast=current;
    const box=UI.toastView(message,undo?async()=>{
      UI.busy(box,true);const generation=storageGeneration;
      try{const result=await UI.request({type:"TSNOOZE_UNDO",undo});if(generation===storageGeneration)applyState(result.state);showToast(t("toastUndone"));}
      catch(error){UI.busy(box,false);box.querySelector(".sz-toast-text").textContent=error.message;}
    }:null);
    current.container.append(box);document.body.append(current.host);
    toastTimer=setTimeout(()=>{current.host.remove();if(toast===current)toast=null;},20000);
  }
  async function refresh() {
    const generation=storageGeneration;
    try{await UI.request({type:"TSNOOZE_REGISTER"});const result=await UI.request({type:"TSNOOZE_GET"});if(generation===storageGeneration)applyState(result.state);}
    catch(error){if(/context invalidated|was updated/i.test(String(error)))cleanup();}
  }
  // The channel this tab is showing, for the toolbar popup's "In this tab" card.
  function currentChannel() {
    const login=Core.channelFromPath(location.pathname);
    if(!login)return null;
    const known=page.items.find(item=>item.info?.login===login&&item.info.nameReliable)?.info||page.items.find(item=>item.info?.login===login)?.info;
    const gameLink=document.querySelector('a[data-a-target="stream-game-link"]');
    let category=gameLink?linkCategory(gameLink):null;
    if(!category&&known?.category)category=known.category;
    let displayName=known?.nameReliable?known.displayName:null;
    if(!displayName){
      const titled=/^(.+?) - Twitch$/.exec(document.title)?.[1]?.trim();
      const heading=document.querySelector(".channel-info-content h1")?.textContent.trim();
      displayName=[heading,titled].find(name=>name&&name.replace(/\s+/g,"").toLowerCase()===login)||heading||null;
    }
    // The channel header's avatar, when Twitch shows it, else one from the sidebar or a card.
    const header=document.querySelector(".channel-info-content, .channel-root__info");
    const avatar=(header&&avatarIn(header,login))||page.items.find(item=>item.info?.login===login&&item.info.avatar)?.info.avatar||null;
    return {login,displayName:Core.normalizeDisplayName(displayName,login),category,...(avatar?{avatar}:{})};
  }
  function cleanup() {
    stopped=true;observer.disconnect();themeObserver.disconnect();resizeObserver.disconnect();
    clearTimeout(scanTimer);clearTimeout(expiryTimer);clearTimeout(toastTimer);clearInterval(overviewTimer);closePanel();toast?.host.remove();manager?.mount.host.remove();
    for(const [target,control] of controls){control.mount.host.remove();target.removeAttribute("data-tsnz-row");target.removeAttribute("data-tsnz-card");target.removeAttribute("data-tsnz-collapsed");}
    for(const [target,chip] of chips){chip.host.remove();target.removeAttribute("data-tsnz-card");}
    for(const node of hiddenNodes)node.removeAttribute("data-tsnz-hidden");
    for(const node of peekNodes)node.removeAttribute("data-tsnz-peek");
    controls.clear();hiddenNodes.clear();peekNodes.clear();chips.clear();
  }
  const observer=new MutationObserver(records=>{
    const targets='#side-nav,.side-nav-card,article,.preview-card,.game-card,[data-target="directory-game__card_container"],[data-a-target^="search-result"],[data-test-selector^="search-result"],[data-a-target="front-page-carousel"]';
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
    if(stopped||area!=="local")return;
    if(changes[Core.VIEW_KEY]){const next=Boolean(changes[Core.VIEW_KEY].newValue?.peek);if(next!==view.peek){view={peek:next};scan();renderManagerPanel();}}
    if(changes[Core.STORAGE_KEY]){storageGeneration++;applyState(Core.normalizeState(changes[Core.STORAGE_KEY].newValue),true);}
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
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(sender.id!==chrome.runtime.id||stopped)return false;
    if(message?.type==="TSNOOZE_SNAPSHOT")sendResponse({items:observations()});
    else if(message?.type==="TSNOOZE_CURRENT"){if(page.items.length===0)page=readPage();sendResponse({channel:currentChannel()});}
    return false;
  });
  const overviewTimer=setInterval(()=>{if(!document.hidden)refreshOverview();},2500);
  try{chrome.storage.local.get(Core.VIEW_KEY).then(stored=>{const next=Boolean(stored?.[Core.VIEW_KEY]?.peek);if(next!==view.peek&&!stopped){view={peek:next};scan();}}).catch(()=>{});}catch(_){}
  scan();refresh();
})();
