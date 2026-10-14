// Live Twitch checks for Twitch Snooze (signed-out public pages).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const EXT = path.resolve(process.argv[2] || path.join(__dirname, '../../extension'));
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const results = []; let current = '';
function check(name, ok, detail = '') { results.push({ group: current, name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' [' + current + '] ' + name + (detail ? ' :: ' + String(detail).slice(0, 300) : '')); }
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(require('os').tmpdir(), 'twitch-snooze-live-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const store = () => sw.evaluate(() => chrome.storage.local.get('twitchSnoozeState').then(r => r.twitchSnoozeState));
  const errors = [];
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const extErrors = () => page.evaluate(() => 0);
  const toastText = () => page.evaluate(() => document.querySelector('twitch-snooze-ui[data-tsnz-owned="toast"]')?.shadowRoot.querySelector('.sz-toast-text')?.textContent || '');
  const cardHidden = login => page.evaluate(l => { const a = document.querySelector(`article a[data-a-target="preview-card-channel-link"][href="/${l}"]`); return a ? !!a.closest('[data-tsnz-hidden="true"]') : 'missing'; }, login);
  const menu = () => page.locator('twitch-snooze-ui[data-tsnz-owned="inline"], twitch-snooze-ui[data-tsnz-owned="floating"]').first();

  current = 'directory';
  await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article twitch-snooze-ui', { timeout: 30000 }); await page.waitForTimeout(2500);
  const cards = await page.evaluate(() => [...document.querySelectorAll('article')].map(a => {
    const link = a.querySelector('a[data-a-target="preview-card-channel-link"]');
    return { login: link?.getAttribute('href')?.slice(1), title: a.querySelector('h4[title]')?.getAttribute('title') || '', game: a.querySelector('a[data-a-target="preview-card-game-link"]')?.getAttribute('href') || '' };
  }).filter(c => c.login));
  const counts = await page.evaluate(() => ({ rows: document.querySelectorAll('#side-nav .side-nav-card').length, rowControls: document.querySelectorAll('#side-nav twitch-snooze-ui[data-tsnz-owned="control"]').length, cards: document.querySelectorAll('article:has(a[data-a-target="preview-card-channel-link"])').length, cardControls: document.querySelectorAll('article twitch-snooze-ui').length, manager: !!document.querySelector('twitch-snooze-ui[data-tsnz-owned="manager"]') }));
  check('moons on live sidebar rows and Snooze on live cards', counts.rowControls === counts.rows && counts.rows > 0 && counts.cardControls >= counts.cards && counts.manager, JSON.stringify(counts));
  const target = cards[2];
  await page.locator(`article:has(a[data-a-target="preview-card-channel-link"][href="/${target.login}"])`).first().hover();
  await page.locator(`article:has(a[data-a-target="preview-card-channel-link"][href="/${target.login}"]) twitch-snooze-ui .sz-trigger`).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'live-card-menu.png') });
  await menu().locator('[data-duration="forever"]').click(); await page.waitForTimeout(500);
  check('Until I unhide hides a live card', (await cardHidden(target.login)) === true, target.login);
  check('live toast', /hidden until you unhide them\./.test(await toastText()), await toastText());
  await page.screenshot({ path: path.join(SHOTS, 'live-toast.png') });
  await page.locator('twitch-snooze-ui[data-tsnz-owned="toast"] .sz-undo').click(); await page.waitForTimeout(500);
  check('Undo restores the live card', (await cardHidden(target.login)) === false);

  // Keyword from a live title word that appears in only some cards.
  const words = {};
  for (const c of cards) for (const w of new Set(c.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4))) (words[w] ||= []).push(c.login);
  const pick = Object.entries(words).find(([, l]) => l.length >= 1 && l.length <= Math.max(1, cards.length / 3));
  current = 'keyword';
  if (pick) {
    const [word, logins] = pick;
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager"] .sz-manager-button').click(); await page.waitForTimeout(300);
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-tab="keywords"]').click();
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] .sz-category-form input').fill(word);
    await page.keyboard.press('Enter'); await page.waitForTimeout(800);
    const hiddenNow = await Promise.all(cards.map(c => cardHidden(c.login)));
    const expected = cards.map(c => logins.includes(c.login));
    check(`keyword "${word}" hides exactly the live cards whose title has it`, hiddenNow.every((h, i) => h === expected[i] || h === 'missing'), JSON.stringify(cards.map((c, i) => [c.login, hiddenNow[i], expected[i]]).filter(([, h, e]) => h !== e)));
    await page.waitForTimeout(2800);
    await page.screenshot({ path: path.join(SHOTS, 'live-manager-keywords-dark.png') });
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-tab="streamers"]').click(); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'live-manager-streamers.png') });
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-tab="keywords"]').click();
    await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-filter-id] .sz-restore').first().click(); await page.waitForTimeout(500);
    check('removing the keyword shows them again', (await Promise.all(logins.map(cardHidden))).every(h => h === false));
    await page.keyboard.press('Escape');
  } else check('found a live title word to test', false);

  // Category rule from a live card stores the link slug.
  current = 'category';
  const gameCard = cards.find(c => c.game.startsWith('/directory/category/'));
  await page.locator(`article:has(a[data-a-target="preview-card-channel-link"][href="/${gameCard.login}"])`).first().hover();
  await page.locator(`article:has(a[data-a-target="preview-card-channel-link"][href="/${gameCard.login}"]) twitch-snooze-ui .sz-trigger`).first().click();
  await menu().locator('[data-scope="category"]').click(); await page.waitForTimeout(600);
  const st = await store();
  const rule = Object.values(st.rules)[0];
  check('live category rule saved with its link slug', rule && rule.category.slug === gameCard.game.split('/')[3], JSON.stringify(rule?.category));
  const sameGame = cards.filter(c => c.game === gameCard.game);
  check('all live cards in that category hidden', (await Promise.all(sameGame.map(c => cardHidden(c.login)))).every(h => h === true || h === 'missing'), sameGame.map(c => c.login).join(','));
  await page.goto('https://www.twitch.tv/directory', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.game-card twitch-snooze-ui', { timeout: 30000 }); await page.waitForTimeout(1500);
  const tileHidden = await page.evaluate(slug => { const a = document.querySelector(`.game-card a[data-a-target="tw-box-art-card-link"][href="/directory/category/${slug}"]`); return a ? !!a.closest('[data-tsnz-hidden="true"]') : 'not on page'; }, rule.category.slug);
  check('matching Browse tile hidden (or not on this page)', tileHidden === true || tileHidden === 'not on page', String(tileHidden));
  await sw.evaluate(() => chrome.storage.local.clear());

  // A keyword for a tag keeps the cards hidden. Twitch removes the tags from a card once it is hidden (it draws only the tags that fit), which used to make the card reappear.
  current = 'tag-keyword';
  await page.goto('https://www.twitch.tv/directory/all/tags/Nederlands', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article twitch-snooze-ui', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500);
  const tagged = await page.evaluate(() => [...document.querySelectorAll('article')].filter(a => [...a.querySelectorAll('.tw-tag')].some(t => /^Nederlands$/i.test(t.textContent.trim()))).map(a => a.querySelector('a[data-a-target="preview-card-channel-link"]')?.getAttribute('href')?.slice(1)).filter(Boolean));
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager"] .sz-manager-button').click(); await page.waitForTimeout(300);
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-tab="keywords"]').click();
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] .sz-category-form input').fill('Nederlands');
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  const tagStates = [];
  for (const wait of [500, 1500, 3000, 5000]) { await page.waitForTimeout(wait); tagStates.push((await Promise.all(tagged.map(cardHidden))).filter(h => h === true).length); }
  check('keyword "Nederlands" hides every card with the Nederlands tag and they stay hidden', tagged.length > 3 && tagStates.every(n => n === tagged.length), tagged.length + ' tagged, hidden over time: ' + tagStates.join(','));
  await page.screenshot({ path: path.join(SHOTS, 'live-tag-keyword.png') });
  await sw.evaluate(() => chrome.storage.local.clear()); await page.waitForTimeout(800);
  check('removing it brings them back', (await Promise.all(tagged.map(cardHidden))).every(h => h === false));

  // Sidebar rows for the picture checks.
  await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#side-nav twitch-snooze-ui', { timeout: 30000 }); await page.waitForTimeout(2000);
  const sideRows = await page.evaluate(() => [...document.querySelectorAll('#side-nav .side-nav-card')].map(r => ({
    login: r.querySelector('a[href]')?.getAttribute('href')?.slice(1),
    avatars: r.querySelectorAll('img.tw-image-avatar').length
  })).filter(r => r.login));

  // Profile pictures for streamers in your rules, from Twitch's image server.
  current = 'pictures';
  const pictured = sideRows.filter(r => r.avatars === 1).slice(0, 2).map(r => r.login);
  await sw.evaluate(logins => chrome.storage.local.set({ twitchSnoozeState: { schema: 1, revision: 1, undoMarkers: {}, rules: {}, filters: {},
    snoozes: { [logins[0]]: { login: logins[0], displayName: logins[0], until: null, createdAt: Date.now() - 1000, duration: 'forever', token: 'live-picture-1' } },
    whitelist: logins[1] ? { [logins[1]]: { login: logins[1], displayName: logins[1], createdAt: Date.now() - 1000 } } : {} } }), pictured);
  await page.waitForTimeout(1500);
  const profiles = (await store()).profiles || {};
  const pictureUrl = /^https:\/\/static-cdn\.jtvnw\.net\/(jtv_user_pictures|user-default-pictures-uv)\/.+-profile_image-70x70\.(png|jpe?g|webp|gif)$/;
  check('learns the picture of a snoozed and an always-shown sidebar streamer', pictured.length === 2 && pictured.every(l => pictureUrl.test(profiles[l]?.avatar || '')), JSON.stringify(profiles));
  check('stores pictures only for those two', Object.keys(profiles).every(l => pictured.includes(l)), Object.keys(profiles).join(','));
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager"] .sz-manager-button').click(); await page.waitForTimeout(1500);
  const livePicture = await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"]').evaluate((h, l) => { const img = h.shadowRoot.querySelector(`[data-login="${l}"] .sz-avatar img`); return img ? { loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth } : null; }, pictured[0]);
  check('Hidden content row shows the picture from Twitch', livePicture?.loaded === true, JSON.stringify(livePicture));
  await page.screenshot({ path: path.join(SHOTS, 'live-pictures-streamers.png') });
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] [data-tab="whitelist"]').click(); await page.waitForTimeout(1200);
  const alwaysLive = await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"]').evaluate((h, l) => { const img = h.shadowRoot.querySelector(`[data-login="${l}"] .sz-avatar img`); return img ? img.complete && img.naturalWidth > 0 : null; }, pictured[1]);
  check('Always show row shows the picture from Twitch', alwaysLive === true, String(alwaysLive));
  await page.screenshot({ path: path.join(SHOTS, 'live-pictures-always.png') });
  await page.keyboard.press('Escape');
  await sw.evaluate(() => chrome.storage.local.clear());

  // Channel page and popup card.
  current = 'channel';
  const chan = cards[0].login;
  await page.goto('https://www.twitch.tv/' + chan, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(9000);
  const reply = await sw.evaluate(async () => { for (const tab of await chrome.tabs.query({})) { try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'TSNOOZE_CURRENT' }); if (r) return r; } catch (_) {} } return null; });
  check('live channel page reports its channel and display name', reply?.channel?.login === chan && reply.channel.displayName && reply.channel.displayName.toLowerCase().replace(/\s/g, '') === chan, JSON.stringify(reply));
  const popup = await ctx.newPage();
  popup.on('pageerror', e => errors.push('popup: ' + e.message));
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront(); await popup.evaluate(() => location.reload()); await popup.waitForTimeout(1500);
  const card = await popup.locator('#current-channel').textContent();
  check('popup card shows the live channel', card.toLowerCase().includes(chan) || card.includes(reply?.channel?.displayName), card);
  const cardImg = await popup.evaluate(() => { const img = document.querySelector('#current-channel .sz-avatar img'); return img ? { loaded: img.complete && img.naturalWidth > 0 } : null; });
  check('popup card shows the channel picture', !!reply?.channel?.avatar && cardImg?.loaded === true, JSON.stringify({ avatar: reply?.channel?.avatar, cardImg }));
  await popup.screenshot({ path: path.join(SHOTS, 'popup-current.png') });
  await popup.locator('.sz-current-toggle').click(); await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(SHOTS, 'popup-current-menu.png') });
  await popup.locator('#current-channel [data-duration="today"]').click(); await popup.waitForTimeout(600);
  check('hiding from the popup card saves it', !!(await store()).snoozes[chan]);
  await popup.screenshot({ path: path.join(SHOTS, 'popup-after-hide.png') });
  await popup.locator('#current-channel .sz-restore').click(); await popup.waitForTimeout(500);
  check('restoring from the popup card', !(await store()).snoozes[chan]);
  await popup.close();

  const snooze = logins => sw.evaluate(logins => chrome.storage.local.set({ twitchSnoozeState: { schema: 1, revision: 1, undoMarkers: {}, rules: {}, filters: {}, whitelist: {}, snoozes: Object.fromEntries(logins.map(login => [login, { login, displayName: login, until: null, createdAt: Date.now() - 1000, duration: 'forever', token: 'live-' + login.slice(0, 20).padEnd(8, 'x') }])) } }), logins);
  const where = sel => page.evaluate(sel => { const el = document.querySelector(sel); return !el ? 'missing' : el.closest('[data-tsnz-hidden="true"]') ? 'hidden' : el.closest('[data-tsnz-peek="true"]') ? 'peek' : 'shown'; }, sel);

  for (const kind of ['videos', 'clips']) {
    current = kind;
    await sw.evaluate(() => chrome.storage.local.clear());
    await page.goto('https://www.twitch.tv/directory/category/minecraft/' + kind, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article twitch-snooze-ui', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500);
    const owners = await page.evaluate(() => [...document.querySelectorAll('article a[data-a-target="preview-card-channel-link"]')].map(a => a.getAttribute('href').slice(1)));
    check(`Snooze on every ${kind} card`, owners.length > 3 && (await page.evaluate(() => document.querySelectorAll('article twitch-snooze-ui[data-tsnz-owned="card-control"]').length)) >= owners.length, owners.length);
    const target = owners[0];
    await snooze([target]); await page.waitForTimeout(800);
    const after = await page.evaluate(login => [...document.querySelectorAll(`article a[data-a-target="preview-card-channel-link"][href="/${login}"]`)].map(a => !!a.closest('[data-tsnz-hidden="true"]')), target);
    const others = await page.evaluate(login => [...document.querySelectorAll('article a[data-a-target="preview-card-channel-link"]')].filter(a => a.getAttribute('href') !== '/' + login).every(a => !a.closest('[data-tsnz-hidden="true"]')), target);
    check(`a hidden streamer's ${kind} disappear, others stay`, after.length > 0 && after.every(Boolean) && others, target + ' ' + JSON.stringify(after));
  }

  current = 'search';
  await sw.evaluate(() => chrome.storage.local.clear());
  await page.goto('https://www.twitch.tv/search?term=minecraft', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-a-target="search-result-live-channel"]', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500);
  const liveLogins = await page.evaluate(() => [...document.querySelectorAll('[data-test-selector="search-result-live-channel__name"] a[href]')].map(a => a.getAttribute('href').slice(1)));
  const videoOwners = await page.evaluate(() => [...document.querySelectorAll('[data-a-target="search-result-video"] a[href*="/video/"]')].map(a => a.getAttribute('href').split('/')[1]));
  check('Snooze on live search results', liveLogins.length > 0 && (await page.evaluate(() => document.querySelectorAll('[data-tsnz-card] > twitch-snooze-ui[data-tsnz-owned="card-control"]').length)) >= liveLogins.length, liveLogins.join(','));
  await snooze([liveLogins[0], ...(videoOwners[0] ? [videoOwners[0]] : [])]); await page.waitForTimeout(800);
  check('hidden streamer removed from live search results', (await where(`[data-test-selector="search-result-live-channel__name"] a[href="/${liveLogins[0]}"]`)) === 'hidden');
  if (videoOwners[0]) check('their past videos removed from search', (await where(`[data-a-target="search-result-video"] a[href^="/${videoOwners[0]}/video/"]`)) === 'hidden');
  check('section headings stay', await page.evaluate(() => [...document.querySelectorAll('main h2')].every(h => !h.closest('[data-tsnz-hidden="true"]'))));
  if (liveLogins[1]) check('other results stay', (await where(`[data-test-selector="search-result-live-channel__name"] a[href="/${liveLogins[1]}"]`)) === 'shown');

  current = 'homepage';
  await sw.evaluate(() => chrome.storage.local.clear());
  await page.goto('https://www.twitch.tv/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-a-target="carousel-display-name"]', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(3000);
  const featured = await page.evaluate(() => document.querySelector('[data-a-target="carousel-display-name"]')?.closest('a[href]')?.getAttribute('href')?.slice(1));
  check('Snooze on the featured stream', !!featured && (await page.locator('[data-a-target="featured-item"] > twitch-snooze-ui[data-tsnz-owned="card-control"]').count()) === 1, featured);
  if (featured) {
    await snooze([featured]); await page.waitForTimeout(2500);
    const now = await page.evaluate(() => ({ login: document.querySelector('[data-a-target="carousel-display-name"]')?.closest('a[href]')?.getAttribute('href')?.slice(1), carouselHidden: !!document.querySelector('[data-a-target="front-page-carousel"]')?.closest('[data-tsnz-hidden="true"]') }));
    check('the carousel moves on from a hidden featured stream', (now.login && now.login !== featured) || now.carouselHidden, featured + ' -> ' + JSON.stringify(now));
    await page.screenshot({ path: path.join(SHOTS, 'live-homepage.png') });
  }

  current = 'peek';
  await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article twitch-snooze-ui', { timeout: 30000 }); await page.waitForTimeout(2000);
  const peekTarget = await page.evaluate(() => document.querySelector('article a[data-a-target="preview-card-channel-link"]').getAttribute('href').slice(1));
  await snooze([peekTarget]); await page.waitForTimeout(600);
  check('hidden before Peek', (await where(`article a[data-a-target="preview-card-channel-link"][href="/${peekTarget}"]`)) === 'hidden');
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager"] .sz-manager-button').click(); await page.waitForTimeout(300);
  await page.locator('twitch-snooze-ui[data-tsnz-owned="manager-panel"] .sz-peek-toggle').click(); await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  check('Peek shows it faded with a Hidden label', (await where(`article a[data-a-target="preview-card-channel-link"][href="/${peekTarget}"]`)) === 'peek' && (await page.locator('twitch-snooze-ui[data-tsnz-owned="peek-chip"]').count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, 'live-peek.png') });
  await sw.evaluate(() => chrome.storage.local.set({ twitchSnoozeView: { peek: false } })); await page.waitForTimeout(400);
  check('Peek off hides it again', (await where(`article a[data-a-target="preview-card-channel-link"][href="/${peekTarget}"]`)) === 'hidden');

  current = 'errors';
  check('no page errors from the extension on live Twitch', errors.filter(e => /twitch-snooze|TwitchSnooze|tsnz|chrome-extension/i.test(e)).length === 0, errors.join(' | '));
  await ctx.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('LIVE HARNESS FAILED', e); process.exit(2); });
