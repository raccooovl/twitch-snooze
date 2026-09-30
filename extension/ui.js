(() => {
  "use strict";
  const Core = globalThis.TwitchSnooze;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const paths = {
    moon: "M20.7 13A8.5 8.5 0 0 1 11 3.3 8.5 8.5 0 1 0 20.7 13Z",
    close: "m6 6 12 12M18 6 6 18",
    check: "m5 12 4 4L19 6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    star: "m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z",
    plus: "M12 5v14M5 12h14",
    chevron: "m9 5 7 7-7 7",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
  };
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [key, value] of Object.entries({viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":name === "more" ? 4 : 1.8,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",class:"sz-icon"})) svg.setAttribute(key,value);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", paths[name] || paths.moon);
    svg.append(path);
    return svg;
  }
  function theme() {
    const root = document.documentElement;
    if (root.classList.contains("tw-root--theme-dark")) return "dark";
    if (root.classList.contains("tw-root--theme-light")) return "light";
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function mount(kind) {
    const host = element("twitch-snooze-ui", {"data-tsnz-owned":kind,"data-theme":theme()});
    const root = host.attachShadow({mode:"open"});
    const stylesheet = element("link", {rel:"stylesheet",href:chrome.runtime.getURL("ui.css")});
    const container = element("div");
    container.style.visibility = "hidden";
    const ready = new Promise(resolve => {
      const reveal = () => {container.style.visibility = "";resolve();};
      stylesheet.addEventListener("load",reveal,{once:true});
      stylesheet.addEventListener("error",reveal,{once:true});
    });
    root.append(stylesheet,container);
    return {host,root,container,ready};
  }
  async function request(message) {
    let result;
    try {result = await chrome.runtime.sendMessage(message);}
    catch(error) {
      if (/context invalidated/i.test(String(error))) throw new Error("Twitch Snooze was updated. Refresh this Twitch tab to use the new menu.");
      throw error;
    }
    if (!result?.ok) throw new Error(result?.error || "Could not update Twitch Snooze. Please reload this Twitch tab.");
    return result;
  }
  function panel(title, onClose) {
    return element("section", {class:"sz-panel","aria-label":title}, element("header", {class:"sz-panel-header"}, element("span", {class:"sz-panel-title"}, icon("moon"), element("span",{class:"sz-name",text:title})), element("button", {type:"button",class:"sz-close","aria-label":"Close",onclick:onClose},icon("close"))));
  }
  function menu(login, displayName, onSelect, onClose, {category, onRule, onWhitelist, whitelisted=false} = {}) {
    const view = panel(whitelisted?(displayName||login):`Snooze ${displayName || login}`, onClose);
    if(whitelisted){
      view.append(element("p",{class:"sz-caption",text:"Always visible. Your hiding rules are paused."}),element("button",{type:"button",class:"sz-whitelist-action",onclick:()=>onWhitelist?.(false)},icon("star"),"Remove from whitelist"));
      return view;
    }
    const presets=element("div",{class:"sz-presets"});
    for (const preset of Core.PRESETS) presets.append(element("button", {type:"button",class:`sz-preset${preset.key === "day" ? " default" : ""}`,"data-duration":preset.key,title:preset.hint,onclick:() => onSelect(preset.key)}, element("span",{text:preset.label})));
    view.append(presets);
    if(category && onRule) {
      const section=element("div",{class:"sz-category-actions"},element("p",{class:"sz-caption",text:"Playing · "+category.name}));
      section.append(element("button",{type:"button",class:"sz-rule-action","data-scope":"channel",onclick:()=>onRule("channel")},element("strong",{text:"Hide here until they switch"})));
      section.append(element("button",{type:"button",class:"sz-rule-action","data-scope":"category",onclick:()=>onRule("category")},element("strong",{text:"Hide this category everywhere"})));
      view.append(section);
    }
    if(onWhitelist)view.append(element("button",{type:"button",class:"sz-whitelist-action",onclick:()=>onWhitelist(true)},icon("star"),"Always show this streamer"));
    view.addEventListener("keydown",event=>{
      const buttons=[...view.querySelectorAll(".sz-preset")];
      const index=buttons.indexOf(event.target);
      if(index<0 || !["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      event.preventDefault();
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
      buttons[next].focus();
    });
    return view;
  }
  function hiddenItems(state, observations=[]) {
    const items=new Map();
    const ensure=info=>{if(!items.has(info.login))items.set(info.login,{login:info.login,displayName:info.displayName||info.login,snooze:null,rules:[],matches:[],categories:[]});return items.get(info.login);};
    for(const entry of Object.values(state.snoozes))if(!Core.isWhitelisted(state,entry.login))ensure(entry).snooze=entry;
    for(const rule of Object.values(state.rules||{}))if(rule.login&&!Core.isWhitelisted(state,rule.login))ensure(rule).rules.push(rule);
    for(const info of observations){
      const reasons=Core.hiddenReasons(state,info);
      if(!reasons.length)continue;
      const item=ensure(info);
      if(info.category&&!item.categories.some(category=>category.key===info.category.key))item.categories.push(info.category);
      for(const reason of reasons)if(reason.type==="rule"&&!reason.rule.login&&!item.matches.some(rule=>rule.id===reason.rule.id))item.matches.push(reason.rule);
    }
    return [...items.values()].sort((a,b)=>(a.snooze?.until||Infinity)-(b.snooze?.until||Infinity)||a.displayName.localeCompare(b.displayName));
  }
  function entries(state, onRestore, {query="",onChange,onWhitelist,observations=[]} = {}) {
    const list = element("div",{class:"sz-list",role:"list","aria-label":"Hidden streamers"});
    const needle=query.trim().replace(/^@/,"").toLowerCase();
    const items = hiddenItems(state,observations).filter(item=>!needle || `${item.login} ${item.displayName} ${[...item.rules,...item.matches].map(rule=>rule.category.name).join(" ")}`.toLowerCase().includes(needle));
    if (!items.length) list.append(element("div",{class:"sz-empty",text:needle?"No hidden streamers match your search.":"No hidden streamers here. Use the moon beside a streamer, or add a category rule."}));
    for (const item of items) {
      const actions=element("div",{class:"sz-entry-actions"},element("button", {type:"button",class:"sz-restore","aria-label":`Restore ${item.displayName || item.login}`,onclick:() => onRestore(item.login)},"Restore"));
      if(onWhitelist)actions.append(element("button",{type:"button",class:"sz-icon-button","aria-label":"Always show "+item.displayName,title:"Always show "+item.displayName,onclick:()=>onWhitelist(item)},icon("star")));
      if(onChange&&item.snooze)actions.append(element("button",{type:"button",class:"sz-change","aria-label":`Change duration for ${item.displayName || item.login}`,onclick:()=>onChange(item.login)},"Change"));
      const details=element("div",{class:"sz-entry-text"},element("span",{class:"sz-entry-name",text:item.displayName,title:item.displayName}));
      const reasons=[];
      if(item.snooze){
        const date=new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date(item.snooze.until));
        details.append(element("span",{class:"sz-entry-date",text:"Back "+date,title:Core.formatRemaining(item.snooze.until)+" · "+Core.formatUntil(item.snooze.until),"aria-label":"Back "+Core.formatUntil(item.snooze.until)}));
      }
      for(const rule of item.rules)reasons.push("Only while playing "+rule.category.name);
      for(const rule of item.matches)reasons.push("Category hidden · "+rule.category.name);
      if(reasons.length)details.append(element("span",{class:"sz-entry-time",text:reasons.join(" · "),title:reasons.join("\n")}));
      if(item.matches.length)actions.querySelector(".sz-restore").title="Show this streamer in the matched categories";
      list.append(element("div",{class:"sz-entry",role:"listitem","data-login":item.login},details,actions));
    }
    return list;
  }
  function restoreRequest(state,login,observations=[]) {
    const item=hiddenItems(state,observations).find(entry=>entry.login===login);
    return item&&(!item.rules.length&&!item.matches.length)
      ? {type:"TSNOOZE_RESTORE",login}
      : {type:"TSNOOZE_SHOW_CHANNEL",login,displayName:item?.displayName||login,categories:item?.categories||[]};
  }
  function managerHeader(onClose){
    return element("header",{class:"sz-manager-header"},element("div",{class:"sz-manager-brand"},icon("moon")),element("div",{class:"sz-manager-heading"},element("span",{class:"sz-eyebrow",text:"Twitch Snooze"}),element("h2",{text:"Hidden Content"})),element("button",{type:"button",class:"sz-close","aria-label":"Close Hidden Content",onclick:onClose},icon("close")));
  }
  function managerCounts(state,observations=[]){return {streamers:hiddenItems(state,observations).length,categories:Object.values(state.rules||{}).filter(rule=>!rule.login).length,whitelist:Object.keys(state.whitelist||{}).length};}
  function tabs(selected,onSelect,counts) {
    const view=element("div",{class:"sz-tabs",role:"group","aria-label":"Manage hidden content"});
    for(const [key,label] of [["streamers","Streamers"],["categories","Categories"],["whitelist","Whitelist"]])view.append(element("button",{type:"button","data-tab":key,"aria-label":label,"aria-pressed":String(selected===key),onclick:()=>onSelect(key)},element("span",{text:label}),counts?element("span",{class:"sz-tab-count","aria-hidden":"true",text:counts[key]}):null));
    return view;
  }
  function categories(state,{observations=[],onAdd,onRemove,onException}={}) {
    const view=element("div",{class:"sz-categories"});
    const form=element("form",{class:"sz-category-form"}),input=element("input",{class:"sz-input",type:"text",placeholder:"e.g. Just Chatting","aria-label":"Category name",maxlength:"120",required:"",list:"sz-category-suggestions",autocomplete:"off"});
    const suggestions=element("datalist",{id:"sz-category-suggestions"});
    for(const name of new Set(observations.map(info=>info.category?.name).filter(Boolean)))suggestions.append(element("option",{value:name}));
    input.placeholder="Add a category…";
    form.append(input,suggestions,element("button",{type:"submit",class:"sz-add","aria-label":"Hide category",title:"Hide category"},icon("plus"),element("span",{text:"Hide"})));
    form.addEventListener("submit",event=>{event.preventDefault();const category=Core.normalizeCategory(input.value);if(category)onAdd?.(category,form);else alert(view,new Error("Enter the category name as it appears on Twitch."));});
    view.append(form);
    const rules=Object.values(state.rules||{}).filter(rule=>!rule.login).sort((a,b)=>a.category.name.localeCompare(b.category.name));
    if(!rules.length)view.append(element("div",{class:"sz-empty",text:"No categories hidden yet."}));
    for(const rule of rules){
      const row=element("section",{class:"sz-category-entry","data-rule-id":rule.id},element("div",{class:"sz-category-heading"},element("strong",{text:rule.category.name,title:rule.category.name}),element("button",{type:"button",class:"sz-restore","aria-label":"Show category "+rule.category.name,onclick:()=>onRemove?.(rule.id)},"Show")));
      if(rule.exceptions.length){
        const exceptions=element("details",{class:"sz-exceptions"},element("summary",{text:rule.exceptions.length+" exception"+(rule.exceptions.length===1?"":"s")}));
        for(const entry of rule.exceptions)exceptions.append(element("div",{class:"sz-exception"},element("span",{text:entry.displayName,title:entry.displayName}),element("button",{type:"button",class:"sz-icon-button","aria-label":"Remove exception for "+entry.displayName,title:"Remove exception",onclick:()=>onException?.(rule.id,entry.login)},icon("close"))));
        row.append(exceptions);
      }
      view.append(row);
    }
    view.append(element("p",{class:"sz-foot",text:"Hidden until removed. Whitelisted streamers stay visible."}));
    return view;
  }
  function whitelist(state,{onAdd,onRemove}={}){
    const view=element("div",{class:"sz-whitelist"});
    const form=element("form",{class:"sz-category-form"});
    const input=element("input",{type:"text",class:"sz-input",placeholder:"Add a streamer…","aria-label":"Whitelist channel name or Twitch link",maxlength:"150",autocomplete:"off",required:""});
    form.append(input,element("button",{type:"submit",class:"sz-add","aria-label":"Add to whitelist",title:"Add to whitelist"},icon("plus"),element("span",{text:"Add"})));
    form.addEventListener("submit",event=>{event.preventDefault();const login=Core.normalizeLogin(input.value);if(login)onAdd?.(login,form);else alert(view,new Error("Enter a Twitch channel name or channel link."));});
    view.append(form,element("p",{class:"sz-caption",text:"Always visible, in every category."}));
    const list=element("div",{class:"sz-list",role:"list","aria-label":"Whitelisted streamers"});
    for(const item of Object.values(state.whitelist||{}).sort((a,b)=>a.displayName.localeCompare(b.displayName))){
      const paused=Object.hasOwn(state.snoozes,item.login)||Object.values(state.rules).some(rule=>rule.login===item.login);
      list.append(element("div",{class:"sz-entry",role:"listitem","data-login":item.login},element("div",{class:"sz-entry-text"},element("span",{class:"sz-entry-name",text:item.displayName,title:item.displayName}),element("span",{class:"sz-entry-time",text:paused?"Hiding rules paused":"Always show"})),element("button",{type:"button",class:"sz-restore","aria-label":"Remove "+item.displayName+" from whitelist",title:"Remove from whitelist; saved rules apply again",onclick:()=>onRemove?.(item.login)},"Remove")));
    }
    if(!list.childElementCount)list.append(element("div",{class:"sz-empty",text:"Keep favourites visible. Add a channel above or use the star beside a hidden streamer."}));
    view.append(list,element("p",{class:"sz-foot",text:"Overrides snoozes and category rules. Removing a streamer resumes their saved rules."}));
    return view;
  }
  function scopeNote(){return element("details",{class:"sz-scope"},element("summary",{text:"About this list"}),element("p",{class:"sz-caption",text:"All saved streamer rules, plus category matches currently loaded in your open Twitch tabs. Hover over a return date for its exact time."}));}
  function alert(view, error) {
    let node = view.querySelector(".sz-alert");
    if (!node) {node = element("p",{class:"sz-alert",role:"alert"});view.append(node);}
    node.textContent = error?.message || String(error);
  }
  function busy(view, value) { view.setAttribute("aria-busy",String(value));for (const control of view.querySelectorAll("button,input,select,textarea")) control.disabled = value; }
  globalThis.TwitchSnoozeUI = Object.freeze({element,icon,theme,mount,request,panel,menu,entries,hiddenItems,restoreRequest,managerHeader,managerCounts,tabs,categories,whitelist,scopeNote,alert,busy});
})();
