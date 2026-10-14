// Browser checks for Twitch Snooze using real captured Twitch markup served at https://www.twitch.tv/.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const EXT = path.resolve(process.argv[2] || path.join(__dirname, '../../extension'));
const FX = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
// Captured markup has its images blanked; give each streamer's avatar a Twitch-style profile picture address.
const AVATAR = login => `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-70x70.png`;
const avatarize = html => html.replace(/href="\/([A-Za-z0-9_]{2,25})"((?:(?!href=)[\s\S]){0,2500}?)tw-image-avatar" src="data:,"/g, (m, login, mid) => `href="/${login}"${mid}tw-image-avatar" src="${AVATAR(login.toLowerCase())}"`);
const NAV = avatarize(FX('nav.html')), CARDS = avatarize(FX('cards.html')), TILES = FX('tiles.html'), SEARCH = avatarize(FX('search.html')), HOME = avatarize(FX('home.html'));
// A 2x2 PNG for picture requests; "broken" pictures answer 404.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMAAAAwdAQHT5sQqAAAAAElFTkSuQmCC', 'base64');
const pictureRequests = [];
// Like Twitch: a card draws only the tags that fit, so a hidden card (no width) loses its tags until it shows again.
const TAG_FIT = `new MutationObserver(records => { for (const record of records) { const node = record.target, hidden = node.getAttribute('data-tsnz-hidden') === 'true';
  for (const card of node.matches('article') ? [node] : node.querySelectorAll('article')) {
    if (hidden && !card.__tags) { card.__tags = [...card.querySelectorAll('.tw-tag')].map(tag => [tag, tag.parentNode]); card.__tags.forEach(([tag]) => tag.remove()); }
    else if (!hidden && card.__tags) { card.__tags.forEach(([tag, parent]) => parent.append(tag)); card.__tags = null; } } } })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-tsnz-hidden'], subtree: true });`;
const results = []; let current = '';
function check(name, ok, detail = '') { results.push({ group: current, name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' [' + current + '] ' + name + (ok || !detail ? '' : ' :: ' + String(detail).slice(0, 400))); }
function page(main, theme, title = 'Twitch') {
  return `<!doctype html><html class="tw-root--theme-${theme}"><head><title>${title}</title><style>#side-nav{width:240px;flex:0 0 240px}</style></head><body><div id="root" style="display:flex">${NAV}<main style="flex:1">${main}</main></div><script>${TAG_FIT}</script></body></html>`;
}
async function launch(lang = 'en', options = {}) {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'twitch-snooze-e2e-' + lang + '-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: lang === 'en' ? 'en-US' : lang,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang}`]
  });
  const state = { theme: options.theme || 'dark', title: null };
  await ctx.route('https://www.twitch.tv/**', route => {
    if (route.request().resourceType() !== 'document') return route.abort();
    const url = new URL(route.request().url());
    const main = url.pathname.startsWith('/search') ? SEARCH.replace(/^<main[^>]*>|<\/main>$/g, '') : url.pathname === '/' ? HOME.replace(/^<main[^>]*>|<\/main>$/g, '') : CARDS + TILES;
    return route.fulfill({ status: 200, contentType: 'text/html', body: page(main, state.theme, state.title ? state.title + ' - Twitch' : 'Twitch') });
  });
  await ctx.route('https://static-cdn.jtvnw.net/**', route => {
    const request = route.request();
    pictureRequests.push({ url: request.url(), referer: request.headers().referer || '' });
    return /broken/.test(request.url()) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: new URL(sw.url()).host, state };
}
(async () => {
  const { ctx, sw, id, state: fixture } = await launch('en');
  const errors = [];
  const store = () => sw.evaluate(() => chrome.storage.local.get('twitchSnoozeState').then(r => r.twitchSnoozeState));
  const reset = () => sw.evaluate(() => chrome.storage.local.clear());
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', e => errors.push('page: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const askCurrent = () => sw.evaluate(async () => { for (const tab of await chrome.tabs.query({})) { try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'TSNOOZE_CURRENT' }); if (r) return r; } catch (_) {} } return 'no-reply'; });
  const open = async (p = '/directory/all') => { await page.goto('https://www.twitch.tv' + p); await page.waitForSelector('twitch-snooze-ui[data-tsnz-owned="control"]', { timeout: 10000 }); await page.waitForTimeout(400); };
  const state = sel => page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return 'missing'; return el.closest('[data-tsnz-hidden="true"]') ? 'hidden' : el.closest('[data-tsnz-peek="true"]') ? 'peek' : 'shown'; }, sel);
  const hidden = async sel => (await state(sel)) === 'hidden';
  const cardHidden = login => hidden(`article a[data-a-target="preview-card-channel-link"][href="/${login}"]`);
  const rowHidden = login => hidden(`#side-nav a[href="/${login}"]`);
  const toastText = () => page.evaluate(() => document.querySelector('twitch-snooze-ui[data-tsnz-owned="toast"]')?.shadowRoot.querySelector('.sz-toast-text')?.textContent || '');
  const clickUndo = () => page.locator('twitch-snooze-ui[data-tsnz-owned="toast"] .sz-undo').click();
  const rowMoon = login => page.locator(`#side-nav .side-nav-card:has(a[href="/${login}"]) twitch-snooze-ui .sz-trigger`).first();
  const cardSnooze = login => page.locator(`article:has(a[data-a-target="preview-card-channel-link"][href="/${login}"]) twitch-snooze-ui .sz-trigger`).first();
  const menu = () => page.locator('twitch-snooze-ui[data-tsnz-owned="floating"]').first();
  const manager = () => page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"]');
  const openManager = async () => { await page.locator('twitch-snooze-ui[data-tsnz-owned="manager"] .sz-manager-button').click(); await page.waitForTimeout(250); };
  const send = message => sw.evaluate(message => new Promise(resolve => chrome.runtime.sendMessage(message, resolve)), message).catch(() => null);
  const setState = async value => { await sw.evaluate(value => chrome.storage.local.set({ twitchSnoozeState: value }), value); await page.waitForTimeout(400); };
  const snoozeState = (logins, extra = {}) => ({ schema: 1, revision: 1, snoozes: Object.fromEntries(logins.map(login => [login, { login, displayName: login, until: null, createdAt: Date.now() - 1000, duration: 'forever', token: 'token-' + login.padEnd(8, 'x') }])), undoMarkers: {}, rules: {}, filters: {}, whitelist: {}, ...extra });

  // ---------- Controls and the Built-in look ----------
  current = 'controls';
  await open();
  const ui = await page.evaluate(() => {
    const hosts = [...document.querySelectorAll('twitch-snooze-ui')];
    const sheets = hosts.map(h => h.shadowRoot.adoptedStyleSheets[0]);
    const btn = document.querySelector('#side-nav twitch-snooze-ui[data-tsnz-owned="control"]').shadowRoot.querySelector('.sz-trigger');
    const managerBtn = document.querySelector('twitch-snooze-ui[data-tsnz-owned="manager"]').shadowRoot.querySelector('.sz-manager-button');
    return { count: hosts.length, links: hosts.reduce((n, h) => n + h.shadowRoot.querySelectorAll('link,style').length, 0), oneSheet: sheets.every(s => s && s === sheets[0]), triggerWidth: getComputedStyle(btn).width, font: getComputedStyle(managerBtn).fontFamily, managerText: managerBtn.textContent, rows: document.querySelectorAll('#side-nav .side-nav-card').length, cards: document.querySelectorAll('article').length, tiles: document.querySelectorAll('.game-card').length };
  });
  check('a control on every sidebar row, stream card and Browse tile', ui.count >= ui.rows + ui.cards + ui.tiles, JSON.stringify(ui));
  check('every control shares one stylesheet', ui.oneSheet && ui.links === 0, JSON.stringify(ui));
  check('Built-in look: Twitch font and 28px moon button', /^Inter/.test(ui.font) && ui.triggerWidth === '28px', ui.font + ' ' + ui.triggerWidth);
  check('sidebar entry reads "Hidden content"', /Hidden content/.test(ui.managerText), ui.managerText);
  check('ui.css is not reachable from Twitch pages', (await page.evaluate(id => fetch(`chrome-extension://${id}/ui.css`).then(() => 'reachable', () => 'blocked'), id)) === 'blocked');

  // ---------- Moon menu ----------
  current = 'menu';
  await rowMoon('smallant').click();
  const smallTitle = await menu().evaluate(h => h.shadowRoot.querySelector('.sz-panel-title').textContent);
  check('group stream menu uses the streamer name', smallTitle === 'Snooze SmallAnt', smallTitle);
  await page.keyboard.press('Escape');
  await rowMoon('northernlion').click();
  const menuInfo = await menu().evaluate(h => {
    const r = h.shadowRoot; const rect = h.getBoundingClientRect(); const side = document.querySelector('#side-nav').getBoundingClientRect();
    return { labels: [...r.querySelectorAll('.sz-duration')].map(b => b.firstElementChild.textContent), hints: [...r.querySelectorAll('.sz-duration-hint')].map(s => s.textContent), intro: r.querySelector('.sz-panel-intro')?.textContent, besideSidebar: rect.left >= side.right, width: Math.round(rect.width), focused: r.activeElement?.dataset.duration };
  });
  check('seven durations with Until I unhide last', menuInfo.labels.length === 7 && menuInfo.labels[6] === 'Until I unhide', menuInfo.labels.join('|'));
  check('every duration shows when they come back', menuInfo.hints.length === 7 && menuInfo.hints[0] === 'back at midnight' && /^back /.test(menuInfo.hints[3]) && menuInfo.hints[6] === 'no end date', menuInfo.hints.join('|'));
  check('menu opens beside the sidebar, 300px wide, focus on 24 hours', menuInfo.besideSidebar && menuInfo.width === 300 && menuInfo.focused === 'day', JSON.stringify(menuInfo));
  check('menu explains you still follow them', /You still follow them/.test(menuInfo.intro || ''), menuInfo.intro);
  await page.keyboard.press('End');
  check('End key reaches Until I unhide', (await menu().evaluate(h => h.shadowRoot.activeElement?.dataset.duration)) === 'forever');
  await menu().locator('[data-duration="forever"]').click(); await page.waitForTimeout(400);
  check('row and card hidden after Until I unhide', (await rowHidden('northernlion')) && (await cardHidden('northernlion')));
  check('toast says hidden until you unhide', (await toastText()) === 'Northernlion hidden until you unhide them.', await toastText());
  await clickUndo(); await page.waitForTimeout(400);
  check('Undo brings the streamer back', !(await rowHidden('northernlion')) && !(await store()).snoozes.northernlion);
  check('Undo confirms', (await toastText()) === 'Change undone.', await toastText());
  await cardSnooze('aspen').click();
  await menu().locator('[data-scope="category"]').click(); await page.waitForTimeout(400);
  check('Hide Overwatch everywhere hides cards and sidebar rows', (await cardHidden('aspen')) && (await cardHidden('flats')) && (await rowHidden('froggerow')));
  check('category saved with its link slug', (await store()).rules['category:overwatch']?.category.slug === 'overwatch-2');
  await clickUndo(); await page.waitForTimeout(400);
  check('Undo of a category rule', !(await cardHidden('aspen')) && Object.keys((await store()).rules).length === 0);
  await rowMoon('buddha').click(); await menu().locator('.sz-whitelist-action').click(); await page.waitForTimeout(300);
  check('Always show from the menu, with Undo', !!(await store()).whitelist.buddha && (await toastText()) === 'buddha will always be shown.', await toastText());
  await rowMoon('buddha').click();
  const alwaysMenu = await menu().evaluate(h => h.shadowRoot.textContent);
  check('always-shown streamer menu offers to stop', /Stop always showing buddha/.test(alwaysMenu), alwaysMenu);
  await page.keyboard.press('Escape'); await reset(); await page.waitForTimeout(300);

  // ---------- Hidden content panel ----------
  current = 'manager';
  await setState(snoozeState(['northernlion']));
  await openManager();
  const panelInfo = await manager().evaluate(h => { const r = h.shadowRoot; return { tabs: [...r.querySelectorAll('.sz-tabs button span:first-child')].map(s => s.textContent), title: r.querySelector('h2')?.textContent, peek: r.querySelector('.sz-peek-toggle')?.getAttribute('aria-pressed'), row: r.querySelector('[data-login="northernlion"]')?.textContent, footer: r.querySelector('.sz-manager-footer')?.textContent, width: Math.round(h.getBoundingClientRect().width) }; });
  check('panel has the four sections, with Always show', panelInfo.tabs.join('|') === 'Streamers|Categories|Keywords|Always show', panelInfo.tabs.join('|'));
  check('title, Peek toggle and Backup in the footer', panelInfo.title === 'Hidden content' && panelInfo.peek === 'false' && /Backup/.test(panelInfo.footer), JSON.stringify(panelInfo));
  check('rows show the avatar initials, name and status', /NONorthernlion|NOnorthernlion/i.test(panelInfo.row.replace(/\s/g, '')) || /northernlion/i.test(panelInfo.row) && /Hidden until you unhide/.test(panelInfo.row), panelInfo.row);
  await manager().locator('[data-login="northernlion"] .sz-more').click();
  const popItems = await manager().evaluate(h => [...h.shadowRoot.querySelectorAll('.sz-popover .sz-popover-item')].map(i => i.textContent));
  check('⋯ menu: change how long, always show, open channel', popItems.join('|') === 'Change how long|Always show Northernlion|Open channel' || popItems.join('|') === 'Change how long|Always show northernlion|Open channel', popItems.join('|'));
  await manager().locator('.sz-popover .sz-change').click();
  check('change how long shows seven durations', await manager().locator('.sz-popover .sz-duration').count() === 7);
  await manager().locator('.sz-popover [data-duration="week"]').click(); await page.waitForTimeout(400);
  check('changing from the panel works', (await store()).snoozes.northernlion.duration === 'week');
  await manager().locator('[data-tab="keywords"]').click();
  await manager().locator('.sz-category-form input').fill('reruns'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  check('keyword "reruns" hides matching cards only', (await cardHidden('caseoh247')) && (await cardHidden('rdcwaitingroom_')) && !(await cardHidden('jynxzi')));
  const kwRow = await manager().evaluate(h => h.shadowRoot.querySelector('[data-filter-id]')?.textContent);
  check('keyword row says how many it hides now', /reruns/.test(kwRow) && /2 hidden now/.test(kwRow), kwRow);
  await manager().locator('.sz-category-form input').fill('drops'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  await manager().locator('[data-tab="streamers"]').click(); await page.waitForTimeout(300);
  const reason = await manager().evaluate(h => h.shadowRoot.querySelector('[data-login="jynxzi"]')?.textContent);
  check('Streamers list explains keyword matches', /Title or tags match “drops”/.test(reason || ''), reason);
  await manager().locator('[data-login="jynxzi"] .sz-restore').click(); await page.waitForTimeout(500);
  check('Show lets a keyword-hidden streamer through', !(await cardHidden('jynxzi')) && (await toastText()) === 'Jynxzi is back.', await toastText());
  await clickUndo(); await page.waitForTimeout(400);
  check('Undo hides them again', await cardHidden('jynxzi'));
  check('clicking outside (the Undo toast) closes the panel', await manager().count() === 0);
  await openManager();
  const overflow = await manager().evaluate(h => [...h.shadowRoot.querySelectorAll('.sz-tabs button')].some(b => b.getBoundingClientRect().right > h.getBoundingClientRect().right));
  check('tabs fit the panel', !overflow);
  await page.keyboard.press('Escape');
  check('Escape closes the panel', await manager().count() === 0);

  // ---------- Tag keywords ----------
  current = 'tag-keyword';
  await reset(); await open();
  await setState(snoozeState([], { revision: 3, filters: { 'keyword:deutsch': { id: 'keyword:deutsch', key: 'deutsch', text: 'Deutsch', exceptions: [], createdAt: Date.now() - 5, token: 'token-keyword-de' } } }));
  const german = ['trymacs', 'eliasn97', 'papaplatte'], samples = [];
  for (const wait of [300, 700, 1500]) { await page.waitForTimeout(wait); samples.push((await Promise.all(german.map(cardHidden))).filter(Boolean).length); }
  const tagsLeft = await page.evaluate(() => document.querySelectorAll('[aria-label="Tag, Deutsch"]').length);
  check('a tag keyword keeps cards hidden after Twitch removes a hidden card\'s tags', samples.every(n => n === german.length) && tagsLeft === 0, `hidden over time ${samples.join(',')}, tags left ${tagsLeft}`);
  check('cards without the tag stay', !(await cardHidden('aspen')) && !(await cardHidden('northernlion')));
  await setState(snoozeState([], { revision: 9 })); await page.waitForTimeout(300);
  check('removing the keyword brings them back with their tags', (await Promise.all(german.map(cardHidden))).every(h => !h) && (await page.evaluate(() => document.querySelectorAll('[aria-label="Tag, Deutsch"]').length)) === 3);

  // ---------- Profile pictures ----------
  current = 'pictures';
  await reset(); await open();
  await setState(snoozeState(['northernlion', 'smallant'], { whitelist: { aspen: { login: 'aspen', displayName: 'Aspen', createdAt: Date.now() - 5 } } }));
  await page.waitForTimeout(600);
  const learnedPictures = (await store()).profiles || {};
  check('pictures are learned for snoozed and always-shown streamers', learnedPictures.northernlion?.avatar === AVATAR('northernlion') && learnedPictures.aspen?.avatar === AVATAR('aspen'), JSON.stringify(learnedPictures));
  check('no picture is stored for streamers without a rule, or for group rows with several avatars', !learnedPictures.buddha && !learnedPictures.jynxzi && !learnedPictures.smallant, Object.keys(learnedPictures).join(','));
  await openManager();
  const rowPicture = await manager().evaluate(h => { const img = h.shadowRoot.querySelector('[data-login="northernlion"] .sz-avatar img'); return img ? { src: img.src, loaded: img.complete && img.naturalWidth > 0, cls: img.parentElement.className, policy: img.referrerPolicy, size: Math.round(img.getBoundingClientRect().width) } : null; });
  check('Streamers row shows the profile picture', rowPicture?.src === AVATAR('northernlion') && rowPicture.loaded && /has-picture/.test(rowPicture.cls) && rowPicture.size === 36, JSON.stringify(rowPicture));
  await manager().locator('[data-tab="whitelist"]').click(); await page.waitForTimeout(300);
  const alwaysPicture = await manager().evaluate(h => { const img = h.shadowRoot.querySelector('[data-login="aspen"] .sz-avatar img'); return img ? { src: img.src, loaded: img.complete && img.naturalWidth > 0 } : null; });
  check('Always show row shows the profile picture', alwaysPicture?.src === AVATAR('aspen') && alwaysPicture.loaded, JSON.stringify(alwaysPicture));
  check('pictures are requested without a referrer', rowPicture?.policy === 'no-referrer' && pictureRequests.some(r => r.url === AVATAR('aspen') && !r.referer), JSON.stringify(pictureRequests.filter(r => /aspen/.test(r.url))));
  await page.keyboard.press('Escape');
  const broken = 'https://static-cdn.jtvnw.net/jtv_user_pictures/broken-profile_image-70x70.png';
  await setState({ ...snoozeState(['missingpic']), profiles: { missingpic: { avatar: broken, seenAt: Date.now() } } });
  await openManager();
  const fallback = await manager().evaluate(h => { const a = h.shadowRoot.querySelector('[data-login="missingpic"] .sz-avatar'); return a ? { img: !!a.querySelector('img'), text: a.textContent, cls: a.className } : null; });
  check('a picture that fails to load leaves the initials', fallback && !fallback.img && fallback.text === 'mi' && !/has-picture/.test(fallback.cls), JSON.stringify(fallback));
  await page.keyboard.press('Escape');

  // ---------- Peek mode ----------
  current = 'peek';
  await reset(); await page.waitForTimeout(300);
  await setState(snoozeState(['northernlion', 'aspen']));
  check('hidden before Peek', (await state('article a[data-a-target="preview-card-channel-link"][href="/aspen"]')) === 'hidden');
  await openManager();
  await manager().locator('.sz-peek-toggle').click(); await page.waitForTimeout(500);
  check('Peek shows hidden cards and rows faded', (await state('article a[data-a-target="preview-card-channel-link"][href="/aspen"]')) === 'peek' && (await state('#side-nav a[href="/northernlion"]')) === 'peek');
  const chip = await page.evaluate(() => { const a = document.querySelector('article a[data-a-target="preview-card-channel-link"][href="/aspen"]').closest('article'); const host = a.querySelector('twitch-snooze-ui[data-tsnz-owned="peek-chip"]'); return host ? host.shadowRoot.textContent + '|' + host.shadowRoot.querySelector('.sz-peek-chip').title : null; });
  check('faded cards carry a "Hidden" label with the reason', chip && chip.startsWith('Hidden|') && /Hidden until you unhide/.test(chip), chip);
  const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('[data-tsnz-peek="true"]')).opacity);
  check('faded to 40%', opacity === '0.4', opacity);
  check('toggle shows Peeking and is saved', (await manager().evaluate(h => h.shadowRoot.querySelector('.sz-peek-toggle').textContent)) === 'Peeking' && (await sw.evaluate(() => chrome.storage.local.get('twitchSnoozeView').then(r => r.twitchSnoozeView))).peek === true);
  await page.keyboard.press('Escape');
  await page.locator('article:has(a[data-a-target="preview-card-channel-link"][href="/aspen"])').first().hover();
  await cardSnooze('aspen').click();
  const peekMenu = await menu().evaluate(h => h.shadowRoot.textContent);
  check('menu on a peeked item says why it is hidden and offers Show', /Aspen is hidden/.test(peekMenu) && /Hidden until you unhide/.test(peekMenu) && /Show Aspen/.test(peekMenu), peekMenu);
  await menu().locator('.sz-show-now').click(); await page.waitForTimeout(400);
  check('Show from Peek restores it', (await state('article a[data-a-target="preview-card-channel-link"][href="/aspen"]')) === 'shown' && !(await store()).snoozes.aspen);
  await page.reload(); await page.waitForSelector('twitch-snooze-ui[data-tsnz-owned="control"]'); await page.waitForTimeout(700);
  check('Peek stays on after a reload', (await state('#side-nav a[href="/northernlion"]')) === 'peek');
  await sw.evaluate(() => chrome.storage.local.set({ twitchSnoozeView: { peek: false } })); await page.waitForTimeout(400);
  check('turning Peek off hides again', (await state('#side-nav a[href="/northernlion"]')) === 'hidden' && await page.locator('twitch-snooze-ui[data-tsnz-owned="peek-chip"]').count() === 0);

  // ---------- Search results ----------
  current = 'search';
  await reset();
  await open('/search?term=minecraft');
  const sr = await page.evaluate(() => ({ controls: document.querySelectorAll('[data-tsnz-card] > twitch-snooze-ui[data-tsnz-owned="card-control"]').length }));
  check('Snooze/Hide on every search result (8 live, 1 offline, 3 videos, 2 categories)', sr.controls >= 14, JSON.stringify(sr));
  const sstate = sel => state(sel);
  await setState(snoozeState(['nooreax', 'rewinside', 'minecraft']));
  check('hidden live channel result', (await sstate('[data-test-selector="search-result-live-channel__name"] a[href="/nooreax"]')) === 'hidden');
  check('hidden streamer\'s past video', (await sstate('[data-a-target="search-result-video"] a[href^="/rewinside/video/"]')) === 'hidden');
  check('hidden offline channel', (await sstate('[data-test-selector="search-result-offline-channel__name"] a[href="/minecraft"]')) === 'hidden');
  check('other results and section headings stay', (await sstate('[data-test-selector="search-result-live-channel__name"] a[href="/bastighg"]')) === 'shown' && await page.evaluate(() => [...document.querySelectorAll('main h2')].every(h => !h.closest('[data-tsnz-hidden="true"]'))));
  await setState({ schema: 1, revision: 2, snoozes: {}, undoMarkers: {}, rules: { 'category:minecraft-dungeons-ii': { id: 'category:minecraft-dungeons-ii', category: { key: 'minecraft-dungeons-ii', name: 'Minecraft Dungeons II' }, login: null, displayName: '', exceptions: [], createdAt: Date.now() - 5, token: 'token-category-1' } }, filters: { 'keyword:craft attack': { id: 'keyword:craft attack', key: 'craft attack', text: 'craft attack', exceptions: [], createdAt: Date.now() - 5, token: 'token-keyword-1' } }, whitelist: {} });
  check('hidden category result', (await sstate('[data-test-selector="search-result-category__name"] a[href="/directory/category/minecraft-dungeons-ii"]')) === 'hidden' && (await sstate('[data-test-selector="search-result-category__name"] a[href="/directory/category/minecraft"]')) === 'shown');
  check('keyword hides matching live results and videos by title', (await sstate('[data-test-selector="search-result-live-channel__name"] a[href="/nooreax"]')) === 'hidden' && (await sstate('[data-a-target="search-result-video"] a[href^="/rewinside/video/"]')) === 'hidden');
  await reset(); await page.waitForTimeout(300);
  const liveRow = page.locator('[data-tsnz-card]:has([data-test-selector="search-result-live-channel__name"] a[href="/bastighg"])').first();
  await liveRow.hover(); await liveRow.locator('twitch-snooze-ui .sz-trigger').click();
  const srMenu = await menu().evaluate(h => h.shadowRoot.querySelector('.sz-panel-title').textContent + '|' + h.shadowRoot.textContent.includes('Playing Minecraft'));
  check('menu from a search result knows the streamer and category', /^Snooze /.test(srMenu) && srMenu.endsWith('true'), srMenu);
  await menu().locator('[data-duration="day"]').click(); await page.waitForTimeout(400);
  check('snoozing from search hides the result', (await sstate('[data-test-selector="search-result-live-channel__name"] a[href="/bastighg"]')) === 'hidden');

  // ---------- Homepage carousel ----------
  current = 'homepage';
  await reset();
  await open('/');
  check('Snooze on the featured stream', await page.locator('[data-a-target="featured-item"] > twitch-snooze-ui[data-tsnz-owned="card-control"]').count() === 1);
  const clicks = await page.evaluate(() => { window.__nextClicks = 0; document.querySelector('[data-a-target="featured-item-right-button"]').addEventListener('click', () => window.__nextClicks++); return true; });
  await setState(snoozeState(['aztecross']));
  await page.waitForTimeout(5500);
  const home = await page.evaluate(() => ({ clicks: window.__nextClicks, carouselHidden: !!document.querySelector('[data-a-target="front-page-carousel"]').closest('[data-tsnz-hidden="true"]') }));
  check('a hidden featured stream makes the carousel skip ahead', home.clicks >= 1, JSON.stringify(home));
  check('if every featured stream stays hidden, the carousel is removed', home.carouselHidden && home.clicks === 6, JSON.stringify(home));
  check('homepage stream cards are covered too', await page.locator('article twitch-snooze-ui[data-tsnz-owned="card-control"]').count() >= 6);
  await sw.evaluate(() => chrome.storage.local.set({ twitchSnoozeView: { peek: true } })); await page.waitForTimeout(500);
  check('in Peek the featured stream is faded, not skipped', (await state('[data-a-target="carousel-display-name"]')) === 'peek');
  await sw.evaluate(() => chrome.storage.local.set({ twitchSnoozeView: { peek: false } }));

  // ---------- Popup ----------
  current = 'popup';
  await reset(); await open();
  const popup = await ctx.newPage(); popup.on('pageerror', e => errors.push('popup: ' + e.message));
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`); await popup.waitForTimeout(500);
  const pop = await popup.evaluate(() => ({ tabs: [...document.querySelectorAll('.sz-tabs button span:first-child')].map(s => s.textContent), font: getComputedStyle(document.body).fontFamily, interLoaded: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded'), peek: !!document.querySelector('#peek-slot .sz-peek-toggle'), footer: document.querySelector('.sz-popup-footer').textContent, current: document.getElementById('current-channel').hidden }));
  check('popup: four sections, Peek toggle, Backup and review links', pop.tabs.join('|') === 'Streamers|Categories|Keywords|Always show' && pop.peek && /Backup/.test(pop.footer) && /Leave a review/.test(pop.footer) && pop.current, JSON.stringify(pop));
  check('popup uses the bundled Inter font', /^Inter/.test(pop.font) && pop.interLoaded, JSON.stringify(pop));
  await popup.locator('.sz-manual summary').click();
  await popup.fill('#channel-input', 'northernlion'); await popup.selectOption('#duration-input', 'forever');
  await popup.click('#snooze-form button[type="submit"]'); await popup.waitForTimeout(600);
  await page.bringToFront(); await page.waitForTimeout(800);
  check('typed lowercase name becomes the name Twitch shows', (await store()).snoozes.northernlion?.displayName === 'Northernlion');
  await popup.bringToFront(); await popup.waitForTimeout(300);
  check('popup row shows the permanent hide', /Hidden until you unhide/.test(await popup.locator('#channels [data-login="northernlion"]').textContent()));
  const popupPicture = await popup.evaluate(() => { const img = document.querySelector('#channels [data-login="northernlion"] .sz-avatar img'); return img ? { src: img.src, loaded: img.complete && img.naturalWidth > 0, size: Math.round(img.getBoundingClientRect().width) } : null; });
  check('popup row shows the picture learned from the Twitch tab', popupPicture?.src === AVATAR('northernlion') && popupPicture.loaded && popupPicture.size === 32, JSON.stringify(popupPicture));
  await popup.locator('#channels [data-login="northernlion"] .sz-more').click();
  await popup.locator('#channels .sz-popover .sz-change').click();
  await popup.locator('#channels .sz-popover [data-duration="week"]').click(); await popup.waitForTimeout(400);
  check('change how long from the popup', (await store()).snoozes.northernlion.duration === 'week');
  check('popup confirmation has Undo and stays in view', await popup.locator('#feedback .sz-undo').count() === 1 && (await popup.evaluate(() => getComputedStyle(document.getElementById('feedback')).position)) === 'sticky');
  await popup.locator('#peek-slot .sz-peek-toggle').click(); await popup.waitForTimeout(400);
  await page.bringToFront(); await page.waitForTimeout(500);
  check('Peek from the popup reaches open Twitch tabs', (await state('#side-nav a[href="/northernlion"]')) === 'peek');
  await sw.evaluate(() => chrome.storage.local.set({ twitchSnoozeView: { peek: false } }));
  await popup.close();

  // ---------- In this tab ----------
  current = 'in-this-tab';
  await reset();
  fixture.title = 'Northernlion';
  await open('/northernlion');
  const fromTab = await askCurrent();
  check('Twitch tab reports its channel', fromTab?.channel?.login === 'northernlion' && fromTab.channel.displayName === 'Northernlion' && fromTab.channel.category?.name === 'We Escaped a Twisted Game', JSON.stringify(fromTab));
  check('Twitch tab reports the channel picture', fromTab?.channel?.avatar === AVATAR('northernlion'), JSON.stringify(fromTab));
  const real = await ctx.newPage(); real.on('pageerror', e => errors.push('popup: ' + e.message));
  await real.setViewportSize({ width: 400, height: 600 });
  await real.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  await real.evaluate(() => location.reload()); await real.waitForLoadState();
  await real.waitForSelector('#current-channel:not([hidden])', { timeout: 5000 }).catch(() => {});
  const card = await real.locator('#current-channel').textContent().catch(() => '');
  const cardPicture = await real.evaluate(() => { const img = document.querySelector('#current-channel .sz-avatar img'); return img ? { src: img.src, loaded: img.complete && img.naturalWidth > 0, size: Math.round(img.getBoundingClientRect().width) } : null; });
  check('popup card shows the channel picture inside the live ring', cardPicture?.src === AVATAR('northernlion') && cardPicture.loaded && cardPicture.size === 44, JSON.stringify(cardPicture));
  check('popup card: name, what they stream, Snooze and Always show', /Northernlion/.test(card) && /Streaming We Escaped a Twisted Game/.test(card) && /Snooze Northernlion/.test(card) && /Always show/.test(card), card);
  await real.locator('.sz-current-toggle').click();
  check('Snooze opens durations and category options', await real.locator('#current-channel .sz-duration').count() === 7 && await real.locator('#current-channel [data-scope="category"]').count() === 1);
  await real.locator('#current-channel [data-duration="forever"]').click(); await real.waitForTimeout(500);
  const after = await real.locator('#current-channel').textContent();
  check('after snoozing: status and Show button', /Hidden until you unhide/.test(after) && /Show Northernlion/.test(after), after);
  await real.locator('#current-channel .sz-restore').click(); await real.waitForTimeout(500);
  check('Show from the card restores', !(await store()).snoozes.northernlion);
  await real.locator('.sz-current-always').click(); await real.waitForTimeout(400);
  check('Always show from the card', !!(await store()).whitelist.northernlion && /Stop always showing/.test(await real.locator('#current-channel').textContent()));
  await real.close();
  fixture.title = null;

  // ---------- Backup ----------
  current = 'backup';
  await reset(); await page.bringToFront(); await open();
  await setState({ ...snoozeState(['aspen']), rules: { 'category:minecraft': { id: 'category:minecraft', category: { key: 'minecraft', name: 'Minecraft', slug: 'minecraft' }, login: null, displayName: '', exceptions: [], createdAt: Date.now() - 5, token: 'token-category-2' } } });
  const opt = await ctx.newPage(); opt.on('pageerror', e => errors.push('options: ' + e.message));
  await opt.goto(`chrome-extension://${id}/options.html`); await opt.waitForTimeout(500);
  check('backup page summary', (await opt.locator('#export-summary').textContent()) === 'This browser has 1 hidden streamer and 1 hidden category.', await opt.locator('#export-summary').textContent());
  const [download] = await Promise.all([opt.waitForEvent('download'), opt.click('#export-button')]);
  const file = path.join(os.tmpdir(), 'twitch-snooze-backup-test.json'); await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('download contains the rules only', backup.app === 'twitch-snooze' && backup.snoozes.aspen?.until === null && backup.rules['category:minecraft'] && !backup.undoMarkers);
  await reset(); await opt.reload(); await opt.waitForTimeout(400);
  check('empty browser disables export', await opt.locator('#export-button').isDisabled() && /nothing saved yet/.test(await opt.locator('#export-summary').textContent()));
  const bad = path.join(os.tmpdir(), 'twitch-snooze-bad-test.json'); fs.writeFileSync(bad, '{not json');
  await opt.setInputFiles('#import-file', bad); await opt.waitForTimeout(300);
  check('broken file rejected clearly', /couldn’t be read as a backup/.test(await opt.locator('#feedback').textContent()));
  await opt.setInputFiles('#import-file', file); await opt.waitForTimeout(300);
  check('import preview', (await opt.locator('#import-summary').textContent()) === 'This backup has 1 hidden streamer and 1 hidden category. Choose how to load it.');
  await opt.click('#import-merge'); await opt.waitForTimeout(500);
  check('Add to my rules imports', !!(await store()).snoozes.aspen && /Backup added/.test(await opt.locator('#feedback').textContent()));
  await opt.setInputFiles('#import-file', file); await opt.waitForTimeout(300); await opt.click('#import-replace');
  check('Replace asks first', await opt.locator('#replace-confirm').isVisible());
  await opt.click('#import-replace-confirm'); await opt.waitForTimeout(500);
  check('Replace done', /Rules replaced/.test(await opt.locator('#feedback').textContent()));
  await opt.close();

  // ---------- Layout ----------
  current = 'layout';
  await reset(); await page.bringToFront(); await open();
  await page.evaluate(() => { const n = document.querySelector('#side-nav'); n.style.width = '50px'; n.style.flex = '0 0 50px'; n.style.overflow = 'hidden'; });
  await page.waitForTimeout(500);
  check('collapsed sidebar gets compact controls', (await page.evaluate(() => document.querySelectorAll('[data-tsnz-collapsed]').length)) > 5);
  await page.evaluate(() => { const n = document.querySelector('#side-nav'); n.style.width = ''; n.style.flex = ''; });
  await page.waitForTimeout(500);
  check('right-click on channel links is left alone', (await page.evaluate(() => { const a = document.querySelector('#side-nav a[href="/aspen"]'); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); a.dispatchEvent(e); return e.defaultPrevented; })) === false);
  fixture.theme = 'light'; await open();
  const light = await page.evaluate(() => { const h = document.querySelector('twitch-snooze-ui[data-tsnz-owned="manager"]'); return h.dataset.theme + '|' + getComputedStyle(h.shadowRoot.querySelector('.sz-manager-button')).color; });
  check('follows Twitch light theme', light === 'light|rgb(14, 14, 16)', light);
  fixture.theme = 'dark';

  current = 'errors';
  const relevant = errors.filter(e => !/net::ERR_FAILED|Failed to load resource/.test(e));
  check('no page, popup or backup-page errors', relevant.length === 0, relevant.join(' | '));
  await ctx.close();

  // ---------- Dutch ----------
  current = 'dutch';
  const nl = await launch('nl');
  const nlPage = nl.ctx.pages()[0] || await nl.ctx.newPage();
  await nlPage.goto('https://www.twitch.tv/directory/all'); await nlPage.waitForSelector('twitch-snooze-ui[data-tsnz-owned="control"]'); await nlPage.waitForTimeout(400);
  const nlButton = await nlPage.evaluate(() => document.querySelector('twitch-snooze-ui[data-tsnz-owned="manager"]').shadowRoot.textContent);
  check('sidebar entry in Dutch', /Verborgen inhoud/.test(nlButton), nlButton);
  await nlPage.locator('#side-nav .side-nav-card:has(a[href="/aspen"]) twitch-snooze-ui .sz-trigger').click();
  const nlMenu = await nlPage.locator('twitch-snooze-ui[data-tsnz-owned="floating"]').evaluate(h => ({ title: h.shadowRoot.querySelector('.sz-panel-title').textContent, labels: [...h.shadowRoot.querySelectorAll('.sz-duration')].map(b => b.textContent) }));
  check('menu in Dutch with Dutch dates', nlMenu.title === 'Aspen verbergen' && nlMenu.labels[0] === 'Vandaagterug om middernacht' && /^1 weekterug (ma|di|wo|do|vr|za|zo) /.test(nlMenu.labels[3]) && nlMenu.labels[6] === 'Tot ik ze weer toongeen einddatum', JSON.stringify(nlMenu));
  await nlPage.locator('twitch-snooze-ui[data-tsnz-owned="floating"] [data-duration="week"]').click(); await nlPage.waitForTimeout(400);
  const nlToast = await nlPage.evaluate(() => document.querySelector('twitch-snooze-ui[data-tsnz-owned="toast"]').shadowRoot.textContent);
  check('confirmation in Dutch', /Aspen 1 week verborgen\./.test(nlToast) && /Ongedaan maken/.test(nlToast), nlToast);
  const nlPopup = await nl.ctx.newPage(); await nlPopup.goto(`chrome-extension://${nl.id}/popup.html`); await nlPopup.waitForTimeout(500);
  const nlPop = await nlPopup.evaluate(() => ({ lang: document.documentElement.lang, tabs: [...document.querySelectorAll('.sz-tabs button span:first-child')].map(s => s.textContent).join('|'), row: document.querySelector('#channels [data-login="aspen"]')?.textContent || '' }));
  check('popup in Dutch', nlPop.lang === 'nl' && nlPop.tabs === 'Streamers|Categorieën|Trefwoorden|Altijd tonen' && /Terug op/.test(nlPop.row), JSON.stringify(nlPop));
  const nlName = await nl.sw.evaluate(() => chrome.runtime.getManifest().name);
  check('extension name in Dutch', nlName === 'Twitch Snooze: kanalen en categorieën verbergen', nlName);
  await nl.ctx.close();

  for (const lang of ['de', 'es', 'pt-BR']) {
    current = lang;
    const other = await launch(lang);
    const p = await other.ctx.newPage(); await p.goto(`chrome-extension://${other.id}/popup.html`); await p.waitForTimeout(400);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.sz-tabs button span:first-child')].map(s => s.textContent).join('|'));
    const expected = { de: 'Streamer|Kategorien|Stichwörter|Immer zeigen', es: 'Streamers|Categorías|Palabras|Siempre', 'pt-BR': 'Streamers|Categorias|Palavras|Sempre' }[lang];
    check('popup tabs translated', tabs === expected, tabs);
    await other.ctx.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILED', e); process.exit(2); });
