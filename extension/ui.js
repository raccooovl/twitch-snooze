(() => {
  "use strict";
  const Core = globalThis.TwitchSnooze, I18n = globalThis.TwitchSnoozeI18n;
  const t = I18n.t, tp = I18n.tp;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const paths = {
    moon: "M20.7 13A8.5 8.5 0 0 1 11 3.3 8.5 8.5 0 1 0 20.7 13Z",
    close: "m6 6 12 12M18 6 6 18",
    check: "m5 12 4 4L19 6",
    star: "m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z",
    plus: "M12 5v14M5 12h14",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    eyeOff: "M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2M4 20 20 4",
    category: "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 3v18",
    keyword: "M4 7h16M4 12h10M4 17h7",
    chevron: "m9 5 7 7-7 7"
  };
  const AVATAR_COLORS = ["#3fb5a3", "#e3624b", "#6c8cff", "#e2b33c", "#c47bd8", "#5cc06a", "#ef7fb0", "#45b2e8"];

  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [key, value] of Object.entries({viewBox:"0 0 24 24","aria-hidden":"true",class:"sz-icon"})) svg.setAttribute(key, value);
    if (name === "more") {
      svg.setAttribute("fill", "currentColor");
      for (const cx of [5, 12, 19]) { const dot = document.createElementNS(SVG_NS, "circle"); dot.setAttribute("cx", cx); dot.setAttribute("cy", 12); dot.setAttribute("r", 2); svg.append(dot); }
      return svg;
    }
    for (const [key, value] of Object.entries({fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"})) svg.setAttribute(key, value);
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
  // One parsed stylesheet is shared by every control on the page instead of loading ui.css per control.
  let sharedSheet;
  function stylesheet() {
    if (sharedSheet !== undefined) return sharedSheet;
    sharedSheet = null;
    try {
      if (typeof CSSStyleSheet === "function" && typeof globalThis.TwitchSnoozeCSS === "string") {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(globalThis.TwitchSnoozeCSS);
        sharedSheet = sheet;
      }
    } catch (_) { sharedSheet = null; }
    return sharedSheet;
  }
  function mount(kind) {
    const host = element("twitch-snooze-ui", {"data-tsnz-owned":kind,"data-theme":theme()});
    const root = host.attachShadow({mode:"open"});
    const container = element("div");
    let adopted = false;
    const sheet = stylesheet();
    if (sheet) {
      try { root.adoptedStyleSheets = [sheet]; adopted = true; } catch (_) { adopted = false; }
    }
    if (!adopted) root.append(element("style", {text: globalThis.TwitchSnoozeCSS || ""}));
    root.append(container);
    return {host,root,container,ready:Promise.resolve()};
  }
  async function request(message) {
    let result;
    try {result = await chrome.runtime.sendMessage(message);}
    catch(error) {
      if (/context invalidated/i.test(String(error))) throw new Error(t("errReload"));
      throw error;
    }
    if (!result?.ok) throw new Error(result?.error || t("errGeneric"));
    return result;
  }
  function initials(name, login) {
    const words = String(name || login).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]);
    return (words[0] || login || "?").slice(0, 2);
  }
  // Initials in a colour, with the streamer's Twitch picture on top when it's known. A picture that fails to load leaves the initials.
  function avatar(login, name, extra = "", url = null) {
    let hash = 0;
    for (const char of String(login)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    const circle = element("span", {class:"sz-avatar" + (extra ? " " + extra : ""),"aria-hidden":"true",style:"background:" + AVATAR_COLORS[hash % AVATAR_COLORS.length]}, initials(name, login));
    const source = Core.normalizeAvatar(url);
    if (source) {
      const image = element("img", {alt:"",referrerpolicy:"no-referrer",loading:"lazy",decoding:"async",draggable:"false",src:source});
      image.addEventListener("error", () => image.remove(), {once:true});
      image.addEventListener("load", () => circle.classList.add("has-picture"), {once:true});
      circle.append(image);
    }
    return circle;
  }
  function closeButton(onClose, label = t("close")) {
    return element("button", {type:"button",class:"sz-close","aria-label":label,onclick:onClose}, icon("close"));
  }
  function panelHeader(title, intro, onClose) {
    return element("header", {class:"sz-panel-header"},
      element("div", {class:"sz-panel-heading"}, element("span", {class:"sz-panel-title sz-name",text:title,title}), intro ? element("p", {class:"sz-panel-intro",text:intro}) : null),
      onClose ? closeButton(onClose) : null);
  }
  function panel(title, onClose, intro = null) {
    return element("section", {class:"sz-panel","aria-label":title}, panelHeader(title, intro, onClose));
  }
  // Each duration shows when the streamer comes back, so nobody has to work it out.
  function durationList(onSelect, {defaultKey = "day"} = {}) {
    const now = Date.now();
    const list = element("div", {class:"sz-durations",role:"group"});
    for (const preset of Core.PRESETS) {
      let hint = "";
      try { hint = Core.returnHint(preset.key, now); } catch (_) { hint = ""; }
      list.append(element("button", {type:"button",class:"sz-duration sz-preset" + (preset.key === defaultKey ? " default" : ""),"data-duration":preset.key,onclick:() => onSelect(preset.key)},
        element("span", {text:preset.label}), element("span", {class:"sz-duration-hint",text:hint})));
    }
    list.addEventListener("keydown", event => {
      const buttons = [...list.querySelectorAll(".sz-duration")];
      const index = buttons.indexOf(event.target);
      if (index < 0 || !["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    return list;
  }
  function action(iconName, text, onclick, extra = {}) {
    return element("button", {type:"button",class:"sz-action" + (extra.accent ? " accent" : ""),onclick,...(extra.attrs || {})}, icon(iconName), element("span", {text}));
  }
  function menu(login, displayName, onSelect, onClose, {category, onRule, onWhitelist, whitelisted = false} = {}) {
    const name = displayName || login;
    if (whitelisted) {
      const view = panel(name, onClose, t("menuAlwaysShownIntro"));
      view.append(action("star", t("menuStopAlwaysShow", {name}), () => onWhitelist?.(false), {accent:true,attrs:{class:"sz-action accent sz-whitelist-action"}}));
      return view;
    }
    const view = panel(t("menuSnoozeTitle", {name}), onClose, t("menuSnoozeIntro"));
    view.append(durationList(onSelect));
    if (category && onRule) {
      view.append(element("div", {class:"sz-divider"}), element("div", {class:"sz-section-label",text:t("menuPlaying", {category:category.name})}),
        action("eyeOff", t("menuHideWhilePlaying", {category:category.name}), () => onRule("channel"), {attrs:{"data-scope":"channel"}}),
        action("category", t("menuHideCategory", {category:category.name}), () => onRule("category"), {attrs:{"data-scope":"category"}}));
    }
    if (onWhitelist) view.append(element("div", {class:"sz-divider"}), action("star", t("menuAlwaysShow", {name}), () => onWhitelist(true), {accent:true,attrs:{class:"sz-action accent sz-whitelist-action"}}));
    return view;
  }
  // Shown in Peek mode for an item your rules hide.
  function hiddenMenu(login, displayName, reasons, {onShow, onSelect, onClose, snoozed = false} = {}) {
    const name = displayName || login;
    const view = panel(t("menuHiddenTitle", {name}), onClose);
    view.append(element("ul", {class:"sz-reasons"}, reasons.map(text => element("li", {text}))),
      element("button", {type:"button",class:"sz-primary sz-wide sz-show-now",onclick:onShow}, element("span", {text:t("menuShowNow", {name})})));
    if (snoozed && onSelect) view.append(element("div", {class:"sz-divider"}), element("div", {class:"sz-section-label",text:t("menuChangeHowLong")}), durationList(onSelect));
    return view;
  }
  function categoryMenu(category, {onHide, onClose} = {}) {
    const view = panel(t("categoryHideTitle", {category:category.name}), onClose, t("categoryHideIntro"));
    view.append(element("button", {type:"button",class:"sz-primary sz-wide sz-rule-action","data-scope":"category",onclick:onHide}, element("span", {text:t("categoryHideButton")})));
    return view;
  }
  function hiddenItems(state, observations=[]) {
    const items=new Map();
    const ensure=info=>{if(!items.has(info.login))items.set(info.login,{login:info.login,displayName:info.displayName||info.login,avatar:Core.avatarFor(state,info.login),snooze:null,rules:[],matches:[],keywords:[],categories:[]});const item=items.get(info.login);if(item.displayName===item.login&&info.displayName&&info.displayName!==info.login)item.displayName=info.displayName;if(!item.avatar&&info.avatar)item.avatar=info.avatar;return item;};
    for(const entry of Object.values(state.snoozes))if(!Core.isWhitelisted(state,entry.login))ensure(entry).snooze=entry;
    for(const rule of Object.values(state.rules||{}))if(rule.login&&!Core.isWhitelisted(state,rule.login))ensure(rule).rules.push(rule);
    for(const info of observations){
      const reasons=Core.hiddenReasons(state,info);
      if(!reasons.length)continue;
      const item=ensure(info);
      if(info.category&&!item.categories.some(category=>category.key===info.category.key))item.categories.push(info.category);
      for(const reason of reasons){
        if(reason.type==="rule"&&!reason.rule.login&&!item.matches.some(rule=>rule.id===reason.rule.id))item.matches.push(reason.rule);
        if(reason.type==="keyword"&&!item.keywords.some(filter=>filter.id===reason.filter.id))item.keywords.push(reason.filter);
      }
    }
    const order=item=>item.snooze?(item.snooze.until===null?Number.MAX_SAFE_INTEGER:item.snooze.until):Infinity;
    return [...items.values()].sort((a,b)=>order(a)-order(b)||a.displayName.localeCompare(b.displayName));
  }
  function reasonTexts(item) {
    const reasons = [];
    if (item.snooze) reasons.push(Core.formatUntil(item.snooze.until));
    for (const rule of item.rules) reasons.push(t("reasonWhilePlaying", {category:rule.category.name}));
    for (const rule of item.matches) reasons.push(t("reasonCategory", {category:rule.category.name}));
    for (const filter of item.keywords) reasons.push(t("reasonKeyword", {keyword:filter.text}));
    return reasons;
  }
  // Reasons for a single page item, from Core.hiddenReasons.
  function reasonTextsFor(reasons) {
    return reasons.map(reason => reason.type === "snooze" ? Core.formatUntil(reason.entry.until)
      : reason.type === "keyword" ? t("reasonKeyword", {keyword:reason.filter.text})
      : reason.rule.login ? t("reasonWhilePlaying", {category:reason.rule.category.name}) : t("reasonCategory", {category:reason.rule.category.name}));
  }
  function rowText(name, meta, title) {
    return element("div", {class:"sz-row-text"}, element("span", {class:"sz-row-name",text:name,title:name}), meta ? element("span", {class:"sz-row-meta",text:meta,title:title || meta}) : null);
  }
  // A small "⋯" menu that closes when focus leaves it or on Escape.
  function moreMenu(wrap, name, buildItems) {
    const button = element("button", {type:"button",class:"sz-more","aria-label":t("moreOptions", {name}),"aria-haspopup":"true","aria-expanded":"false"}, icon("more"));
    let popover = null;
    const close = (focus) => { popover?.remove(); popover = null; button.setAttribute("aria-expanded", "false"); if (focus) button.focus(); };
    button.addEventListener("click", () => {
      if (popover) { close(); return; }
      popover = element("div", {class:"sz-popover",role:"menu"});
      buildItems(popover, close);
      popover.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } });
      // Wait a tick: swapping the menu's contents (Change how long) briefly drops focus.
      popover.addEventListener("focusout", () => setTimeout(() => { const active = wrap.getRootNode().activeElement; if (popover && !wrap.contains(active)) close(); }, 0));
      wrap.append(popover);
      button.setAttribute("aria-expanded", "true");
      popover.querySelector("button,a")?.focus();
    });
    return button;
  }
  function entries(state, onRestore, {query="",onChange,onWhitelist,observations=[]} = {}) {
    const list = element("div",{class:"sz-list",role:"list","aria-label":t("tabStreamers")});
    const needle=query.trim().replace(/^@/,"").toLowerCase();
    const items = hiddenItems(state,observations).filter(item=>!needle || `${item.login} ${item.displayName} ${[...item.rules,...item.matches].map(rule=>rule.category.name).join(" ")} ${item.keywords.map(filter=>filter.text).join(" ")}`.toLowerCase().includes(needle));
    if (!items.length) list.append(element("div",{class:"sz-empty",text:needle?t("emptySearch"):t("emptyStreamers")}));
    for (const item of items) {
      const name = item.displayName || item.login;
      const reasons = reasonTexts(item);
      const wrap = element("div", {class:"sz-row-wrap",role:"listitem","data-login":item.login});
      const more = moreMenu(wrap, name, (popover, close) => {
        if (onChange && item.snooze) popover.append(element("button", {type:"button",class:"sz-popover-item sz-change",role:"menuitem",onclick:() => {
          popover.replaceChildren(element("div", {class:"sz-popover-title",text:t("changeHowLong")}), durationList(duration => { close(); onChange(item.login, duration, item); }, {defaultKey:item.snooze.duration}));
          popover.querySelector(".sz-duration.default,.sz-duration")?.focus();
        }}, t("changeHowLong")));
        if (onWhitelist) popover.append(element("button", {type:"button",class:"sz-popover-item sz-always",role:"menuitem",onclick:() => { close(); onWhitelist(item); }}, t("menuAlwaysShow", {name})));
        popover.append(element("a", {class:"sz-popover-item",role:"menuitem",href:"https://www.twitch.tv/" + item.login,target:"_blank",rel:"noopener noreferrer"}, t("openChannel")));
      });
      const restore = element("button", {type:"button",class:"sz-secondary sz-restore","aria-label":t("menuShowNow", {name}),title:item.matches.length || item.keywords.length ? t("showDespiteRules") : null,onclick:() => onRestore(item.login, item)}, t("show"));
      wrap.append(element("div", {class:"sz-row"}, avatar(item.login, name, "", item.avatar), rowText(name, reasons.join("; "), reasons.join("\n")), restore, more));
      list.append(wrap);
    }
    if (items.length) list.append(element("p", {class:"sz-note",text:t("listNote")}));
    return list;
  }
  function restoreRequest(state,login,observations=[]) {
    const item=hiddenItems(state,observations).find(entry=>entry.login===login);
    return item&&(!item.rules.length&&!item.matches.length&&!item.keywords.length)
      ? {type:"TSNOOZE_RESTORE",login}
      : {type:"TSNOOZE_SHOW_CHANNEL",login,displayName:item?.displayName||login,categories:item?.categories||[],filters:(item?.keywords||[]).map(filter=>filter.id)};
  }
  function peekToggle(peek, onPeek) {
    return element("button", {type:"button",class:"sz-peek-toggle","aria-pressed":String(Boolean(peek)),title:t("peekHelp"),onclick:() => onPeek(!peek)}, icon(peek ? "eye" : "eyeOff"), element("span", {text:peek ? t("peekOnLabel") : t("peek")}));
  }
  function managerHeader(onClose, {peek = false, onPeek} = {}){
    return element("header",{class:"sz-manager-header"},
      element("div",{class:"sz-brand-tile"},icon("moon")),
      element("div",{class:"sz-manager-heading"},element("h2",{text:t("managerTitle")}),element("p",{text:t("managerSubtitle")})),
      onPeek ? peekToggle(peek, onPeek) : null,
      closeButton(onClose, t("closeManager")));
  }
  function managerCounts(state,observations=[]){return {streamers:hiddenItems(state,observations).length,categories:Object.values(state.rules||{}).filter(rule=>!rule.login).length,keywords:Object.keys(state.filters||{}).length,whitelist:Object.keys(state.whitelist||{}).length};}
  const TABS=[["streamers","tabStreamers"],["categories","tabCategories"],["keywords","tabKeywords"],["whitelist","tabAlwaysShow"]];
  function tabs(selected,onSelect,counts) {
    const view=element("nav",{class:"sz-tabs","aria-label":t("tabsLabel")});
    for(const [key,label] of TABS)view.append(element("button",{type:"button","data-tab":key,"aria-pressed":String(selected===key),onclick:()=>onSelect(key)},element("span",{text:t(label)}),counts?element("span",{class:"sz-tab-count",text:counts[key]}):null));
    return view;
  }
  function addForm({placeholder, label, button, maxlength, list, onSubmit}) {
    const input = element("input", {class:"sz-input",type:"text",placeholder,"aria-label":label,maxlength:String(maxlength),required:true,autocomplete:"off",list});
    const form = element("form", {class:"sz-form sz-category-form"}, input, element("button", {type:"submit",class:"sz-primary sz-add"}, icon("plus"), element("span", {text:button})));
    form.addEventListener("submit", event => { event.preventDefault(); onSubmit(input.value, form); });
    return form;
  }
  function exceptionList(entries, label, onRemove) {
    const details = element("details", {class:"sz-exceptions"}, element("summary", {text:tp("exceptions", entries.length)}));
    for (const entry of entries) details.append(element("div", {class:"sz-exception"}, element("span", {text:entry.displayName,title:entry.displayName}),
      element("button", {type:"button",class:"sz-close","aria-label":t("removeException", {name:entry.displayName,category:label}),title:t("removeException", {name:entry.displayName,category:label}),onclick:() => onRemove(entry.login)}, icon("close"))));
    return details;
  }
  function categories(state,{observations=[],onAdd,onRemove,onException}={}) {
    const view=element("div",{class:"sz-categories"});
    const seen=new Map();
    for(const info of observations)if(info.category&&!seen.has(info.category.name))seen.set(info.category.name,info.category);
    const suggestions=element("datalist",{id:"sz-category-suggestions"},[...seen.keys()].map(name=>element("option",{value:name})));
    const form=addForm({placeholder:t("addCategoryPlaceholder"),label:t("addCategoryLabel"),button:t("hide"),maxlength:120,list:"sz-category-suggestions",onSubmit:(value,form)=>{
      const typed=Core.normalizeCategory(value);
      // A name picked from Twitch's own cards keeps its link identity, so it also works in other display languages.
      const known=typed&&[...seen.values()].find(category=>category.key===typed.key);
      const category=known&&known.slug?{...typed,slug:known.slug}:typed;
      if(category)onAdd?.(category,form);else alert(view,new Error(t("errEnterCategory")));
    }});
    view.append(form,suggestions);
    const rules=Object.values(state.rules||{}).filter(rule=>!rule.login).sort((a,b)=>a.category.name.localeCompare(b.category.name));
    if(!rules.length)view.append(element("div",{class:"sz-empty",text:t("emptyCategories")}));
    const list=element("div",{class:"sz-list",role:"list"});
    for(const rule of rules){
      const name=rule.category.name;
      const row=element("div",{class:"sz-row-wrap sz-category-entry",role:"listitem","data-rule-id":rule.id},
        element("div",{class:"sz-row"},element("span",{class:"sz-tile"},icon("category")),
          element("div",{class:"sz-row-text"},element("span",{class:"sz-row-name",text:name,title:name}),rule.exceptions.length?exceptionList(rule.exceptions,name,login=>onException?.(rule.id,login)):element("span",{class:"sz-row-meta",text:t("categoryEverywhere")})),
          element("button",{type:"button",class:"sz-secondary sz-restore","aria-label":t("showCategory",{category:name}),onclick:()=>onRemove?.(rule.id,rule)},t("show"))));
      list.append(row);
    }
    view.append(list);
    if(rules.length)view.append(element("p",{class:"sz-note",text:t("categoriesNote")}));
    return view;
  }
  function keywords(state,{observations=[],onAdd,onRemove,onException}={}) {
    const view=element("div",{class:"sz-keywords"});
    const form=addForm({placeholder:t("addKeywordPlaceholder"),label:t("addKeywordLabel"),button:t("hide"),maxlength:80,onSubmit:(value,form)=>{const keyword=Core.normalizeKeyword(value);if(keyword)onAdd?.(keyword.text,form);else alert(view,new Error(t("errKeywordInvalid")));}});
    view.append(form,element("p",{class:"sz-caption",text:t("keywordsIntro")}));
    const filters=Object.values(state.filters||{}).sort((a,b)=>a.text.localeCompare(b.text));
    if(!filters.length)view.append(element("div",{class:"sz-empty",text:t("emptyKeywords")}));
    const list=element("div",{class:"sz-list",role:"list"});
    for(const filter of filters){
      const matched=new Set(observations.filter(info=>Core.hiddenReasons(state,info).some(reason=>reason.type==="keyword"&&reason.filter.id===filter.id)).map(info=>info.login)).size;
      const meta=filter.exceptions.length?exceptionList(filter.exceptions,filter.text,login=>onException?.(filter.id,login)):element("span",{class:"sz-row-meta sz-keyword-count",text:matched?tp("hiddenNow",matched):t("keywordNoMatches")});
      if(filter.exceptions.length&&matched)meta.prepend(element("span",{class:"sz-row-meta sz-keyword-count",text:tp("hiddenNow",matched)}));
      list.append(element("div",{class:"sz-row-wrap sz-category-entry",role:"listitem","data-filter-id":filter.id},
        element("div",{class:"sz-row"},element("span",{class:"sz-tile"},icon("keyword")),
          element("div",{class:"sz-row-text"},element("span",{class:"sz-row-name",text:filter.text,title:filter.text}),meta),
          element("button",{type:"button",class:"sz-secondary sz-restore","aria-label":t("removeKeyword",{keyword:filter.text}),onclick:()=>onRemove?.(filter.id,filter)},t("remove")))));
    }
    view.append(list);
    if(filters.length)view.append(element("p",{class:"sz-note",text:t("keywordsNote")}));
    return view;
  }
  function whitelist(state,{onAdd,onRemove,observations=[]}={}){
    const view=element("div",{class:"sz-whitelist"});
    const form=addForm({placeholder:t("addAlwaysPlaceholder"),label:t("addAlwaysLabel"),button:t("add"),maxlength:150,onSubmit:(value,form)=>{const login=Core.normalizeLogin(value);if(login)onAdd?.(login,form);else alert(view,new Error(t("errEnterChannel")));}});
    view.append(form,element("p",{class:"sz-caption",text:t("alwaysIntro")}));
    const list=element("div",{class:"sz-list",role:"list","aria-label":t("tabAlwaysShow")});
    for(const item of Object.values(state.whitelist||{}).sort((a,b)=>a.displayName.localeCompare(b.displayName))){
      const paused=Object.hasOwn(state.snoozes,item.login)||Object.values(state.rules).some(rule=>rule.login===item.login);
      list.append(element("div",{class:"sz-row-wrap",role:"listitem","data-login":item.login},element("div",{class:"sz-row"},avatar(item.login,item.displayName,"",Core.avatarFor(state,item.login)||observations.find(info=>info.login===item.login&&info.avatar)?.avatar),rowText(item.displayName,paused?t("rulesPaused"):t("alwaysShown")),
        element("button",{type:"button",class:"sz-secondary sz-restore","aria-label":t("removeAlways",{name:item.displayName}),title:t("removeAlwaysHelp"),onclick:()=>onRemove?.(item.login,item)},t("remove")))));
    }
    if(!list.childElementCount)list.append(element("div",{class:"sz-empty",text:t("emptyAlways")}));
    view.append(list);
    if(Object.keys(state.whitelist||{}).length)view.append(element("p",{class:"sz-note",text:t("alwaysNote")}));
    return view;
  }
  function toastView(text, onUndo) {
    const view = element("div", {class:"sz-toast",role:"status","aria-live":"polite"}, icon("check"), element("span", {class:"sz-toast-text",text}));
    if (onUndo) view.append(element("button", {type:"button",class:"sz-undo",onclick:onUndo}, t("undo")));
    return view;
  }
  function peekChip(reasons) {
    return element("span", {class:"sz-peek-chip",title:reasons.join("\n")}, icon("eyeOff"), element("span", {text:t("peekLabelHidden")}));
  }
  function managerFooter(onBackup) {
    return element("footer", {class:"sz-manager-footer"}, element("span", {text:t("savedLocally")}),
      onBackup ? element("button", {type:"button",class:"sz-link-button",onclick:onBackup}, t("backup")) : null,
      element("span", {text:t("escToClose")}));
  }
  function alert(view, error) {
    let node = view.querySelector(".sz-alert");
    if (!node) {node = element("p",{class:"sz-alert",role:"alert"});view.append(node);}
    node.textContent = error?.message || String(error);
  }
  // Fills data-i18n / data-i18n-placeholder / -aria-label / -title in static page markup.
  function localize(root = document) {
    if (root === document) document.documentElement.lang = I18n.locale;
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const attribute of ["placeholder", "aria-label", "title"]) {
      for (const node of root.querySelectorAll("[data-i18n-" + attribute + "]")) node.setAttribute(attribute, t(node.getAttribute("data-i18n-" + attribute)));
    }
  }
  function busy(view, value) { view.setAttribute("aria-busy",String(value));for (const control of view.querySelectorAll("button,input,select,textarea")) control.disabled = value; }
  globalThis.TwitchSnoozeUI = Object.freeze({element,icon,theme,mount,request,avatar,panel,menu,hiddenMenu,categoryMenu,durationList,entries,hiddenItems,reasonTexts,reasonTextsFor,restoreRequest,managerHeader,managerCounts,managerFooter,peekToggle,tabs,categories,keywords,whitelist,toastView,peekChip,alert,busy,localize,t,tp});
})();
