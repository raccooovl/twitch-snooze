# Browser checks

These drive the real unpacked extension in Chromium with Playwright.

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser/e2e.js     # 102 checks against Twitch markup captured in fixtures/, in five languages, no network needed
node tests/browser/live.js    # 35 checks on public twitch.tv pages (signed out)
```

Both open a visible browser window (extensions need one). Set `CHROMIUM_PATH` to use a specific Chromium build. `live.js` saves screenshots to `shots/`.

`fixtures/` holds sidebar, stream-card, Browse-tile, search-results and homepage markup captured from twitch.tv on 13 October 2026 (images and scripts removed). Recapture it when Twitch changes its markup.
