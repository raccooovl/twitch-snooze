# Twitch Snooze 0.6.1 verification

Verified on 13 October 2026 with the unpacked Manifest V3 extension in Chromium 141.0.7390.37 (Playwright), using disposable profiles. This file is a development record and is not part of the store package.

## Logic and background tests

`node --test tests/core.test.cjs`: **72 passed, 0 failed.** `node tools/build-ui-css.cjs --check` and `node tools/build-locales.cjs --check` both pass.

- New in 0.6.1: profile-picture addresses are accepted only from Twitch's image server (`jtv_user_pictures` or `user-default-pictures-uv`, https, no query, no other hosts, no stream thumbnails) and sized to 70×70; stored pictures are kept for streamers your rules mention, dropped within 30 days once no rule mentions them, capped at 300 and left out of backups; the worker stores one only for a streamer in your rules and doesn't write when it hasn't changed; Undo ignores them; the overview passes valid ones only.
- All 0.5.0 tests still pass, run against the English messages as Chrome provides them. Four expected texts changed with the new wording ("Stop always showing…", the clock error, return dates) and `formatRemaining` was replaced by return-date helpers.
- New: every message key used anywhere in the code exists in all five languages with the same placeholders, and the generated `_locales` files match `tools/messages.cjs`. Store limits are checked (name ≤ 75, summary ≤ 132 characters, short name ≤ 12).
- New: Dutch output end to end (durations, confirmations, "Terug op wo 30 sep om 14:00", plural lists, backup errors) and British English times ("back Thu 14:00").

## Browser checks with real Twitch markup

`tests/browser/e2e.js` serves sidebar, stream-card, Browse-tile, search and homepage markup captured from live Twitch (with Twitch-style profile-picture addresses served locally), then drives the real extension: **102 passed, 0 failed.**

- New in 0.6.1, tag keywords: the fixture page now behaves like Twitch and removes a card's tags while the card is hidden. With the keyword `Deutsch`, the three German-tagged cards stay hidden at every sample and the others stay visible; removing the keyword brings the cards back with their tags. The same check fails on the previous code (the cards reappear), so it covers the reported bug.
- New in 0.6.1, pictures: learned for a snoozed and an always-shown streamer, not for streamers without a rule or a group row with several avatars; shown in Streamers and Always show rows (36 px, loaded, no referrer); a picture that fails to load leaves the initials; the Twitch tab reports the channel picture; the popup's In this tab card shows it at 44 px and its list row at 32 px.

- Built-in look: one shared stylesheet, Inter font, 28 px moon buttons, "Hidden content" sidebar entry, Twitch light theme followed.
- Moon menu: opens beside the sidebar at 300 px with focus on 24 hours; seven durations each with a return hint ("back at midnight", "back Tue, Oct 20", "no end date"); End key; Until I unhide with Undo; Hide category everywhere with slug and Undo; Always show with Undo; always-shown menu offers to stop.
- Hidden content: four sections (Always show renamed); Peek toggle and Backup link; rows with reason; ⋯ menu (Change how long, Always show, Open channel) and changing duration from it; keywords with match counts; Show for keyword matches with Undo; clicking outside closes; tabs fit.
- Peek: hidden cards and rows faded to 40 % with a "Hidden" label carrying the reason; menu on a faded item explains and offers Show; Show restores; Peek persists across reload and turns off cleanly.
- Search results: controls on all 14 results; a hidden streamer's live result, past video and offline channel removed; headings and other results kept; category result hidden by a category rule; keyword hides by title; snoozing from a search result works and knows the category.
- Homepage: Snooze on the featured stream; a hidden featured stream presses the carousel's next button; if it never changes, the carousel is removed after six tries; homepage stream cards covered; in Peek the featured stream is faded instead of skipped.
- Popup: four sections, Peek toggle, Backup and review links; bundled Inter loaded; typed lowercase names corrected; Change how long via ⋯; sticky confirmation with Undo; Peek from the popup reaches Twitch tabs.
- In this tab: channel, display name and category reported; card with Snooze and Always show; durations and category options; Show and Always show from the card.
- Backup page: summary, download, disabled when empty, broken file rejected, preview, merge, replace with confirmation.
- Layout: collapsed sidebar, right-click untouched, light theme. No page, popup or Backup-page errors.
- Languages: with Chromium in Dutch, the sidebar entry, menu (with Dutch dates), confirmation, popup and extension name are Dutch; popup tabs checked in German, Spanish and Brazilian Portuguese.

## Live Twitch

`tests/browser/live.js` on public, signed-out twitch.tv: **35 passed, 0 failed.**

- New in 0.6.1: on Twitch's Nederlands tag page, the keyword `Nederlands` hid all 30 tagged cards and they stayed hidden at 0.5, 2, 5 and 10 seconds; before the fix they reappeared within about a second (Twitch drops a hidden card's tags). Removing the keyword brought them back. Pictures were learned for a snoozed (zackrawrr) and an always-shown (hasanabi) sidebar streamer and nobody else, and loaded from Twitch's image server in Hidden content's Streamers and Always show rows; on a channel page (Jynxzi) the popup card showed the channel's picture.
- Directory: controls on all live rows and cards; Until I unhide and Undo; keyword from live titles hides exactly the matching cards; category rule saves its slug and hides matching cards and the Browse tile.
- Channel page and popup card: channel and display name reported; Snooze and Show from the card.
- Video and clip lists (Minecraft category): Snooze on every card; a hidden streamer's videos and clips disappear, others stay.
- Search ("minecraft"): Snooze on live results; a hidden streamer's live result and past videos removed; headings and other results kept.
- Homepage: Snooze on the featured stream; snoozing the featured streamer moved the carousel to the next stream (aztecross → beefquake).
- Peek on live cards, and off again.
- No extension errors (Twitch's own `getLayoutMap` warnings ignored).

## Visual review (0.6.0)

Screenshots were reviewed on live Twitch in its light theme (the signed-out default) and dark theme: moon menu, Hidden content panel (Streamers, Keywords, Always show), Peek on the Browse grid, search results and the homepage after a carousel skip; popup in light and dark with the channel card and its menu; Backup page in dark; the panel at a 360 px-wide window. Two issues found and fixed: popup tabs overflowing at 400 px, and the sidebar entry's label alignment.

## Visual review (0.6.1)

Live screenshots of Hidden content (Streamers and Always show) with real profile pictures in the dark sidebar layout, and the popup's In this tab card with the picture inside the live ring. One issue found and fixed: the card's picture was 32 px instead of the intended 44 px because a popup list rule overrode it (also true in 0.6.0).

## Upgrade

Saved 0.5.x and 0.6.0 data is read unchanged. 0.6.0 added the Peek setting (`twitchSnoozeView`); 0.6.1 adds remembered profile-picture addresses (`profiles` in the saved state), which fill in as Twitch pages are visited.

## Scope and limits

- Translations were written without native-speaker review; a quick review per language before publishing is recommended. Message keys and placeholders are machine-checked.
- Tests used Chromium, not branded Chrome or Edge.
- The real toolbar popup can't be driven by the test browser; popup.html was loaded in a background tab while the Twitch tab was active, which is what the popup sees.
- The test browser can't play Twitch video, so Twitch leaves the stream-info area on channel pages empty; the channel card's category came from the sidebar there.
- The live carousel test depends on which streamers Twitch features at the time.
- Public live checks used a signed-out profile; signed-in Following pages are covered by Twitch-shaped markup only.
