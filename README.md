# Twitch Snooze: Hide Channels & Categories

Clean up Twitch by hiding streamers and categories without unfollowing anyone. Twitch Snooze is a browser extension for desktop Chrome and Microsoft Edge.

**Source version 0.4.2 · Manifest V3 · MIT licensed · No build step or runtime dependencies**

## Install from a browser store

Use the official store version for automatic updates:

- [Install Twitch Snooze for Chrome](https://chromewebstore.google.com/detail/fhdnokolfhacaokdidacdcabpimhgdkm)
- [Install Twitch Snooze for Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/glcfgomfljbmcgomligjegknmhpebohm)

As checked on October 1, 2026, Edge version 0.4.2 is published; Chrome version 0.4.1 is published, with 0.4.2 under review. Store versions can differ while an update is under review. Version 0.4.2 updates the extension name and description; its features and data handling are the same as 0.4.1.

## Get started

[Hide Twitch channels without unfollowing](https://perfsn-extensions.basstank2004.chatgpt.site/twitch-snooze/hide-channels/?utm_source=github&utm_medium=referral&utm_campaign=discovery_2026_10&utm_content=twitch_readme_guide)

[Product page](https://perfsn-extensions.basstank2004.chatgpt.site/twitch-snooze/) · [Setup and troubleshooting guide](https://perfsn-extensions.basstank2004.chatgpt.site/twitch-snooze/guide/)

1. Install Twitch Snooze from the store for your browser.
2. Open or refresh Twitch on desktop.
3. Click the moon beside a channel to snooze it, or open **Hidden Content** to manage hidden streamers, categories and your whitelist.

## Features

- Snooze for Today, 24 hours, 3 days, 1 week, 2 weeks, or 1 month.
- Hide a category, or hide one streamer only while they play it.
- Keep favourite streamers visible using a whitelist or category exceptions.
- Manage rules in the Hidden Content panel or the extension toolbar popup.
- Store rules locally without analytics, tracking servers, or external API calls.

## Install from source for development

1. Clone or download this repository.
2. Open `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension` folder containing `manifest.json`.
4. Refresh Twitch, then click the moon beside a channel or **Hidden Content** near the sidebar header.

To apply source updates, reload the extension at `edge://extensions` and refresh Twitch. The extension also supports Chromium browsers that implement Manifest V3.

For Chrome, use `chrome://extensions` with the same **Developer mode** and **Load unpacked** steps. Store installation above is recommended for everyday use.

## Development

All runtime source is in `extension/`:

- `core.js`: rule normalization, duration handling, matching and whitelist precedence.
- `background.js`: local state, serialized changes, expiry alarms and tab observations.
- `content.js` / `content.css`: Twitch integration and hiding supported cards.
- `ui.js` / `ui.css`: shared controls, menus and Hidden Content manager.
- `popup.html` / `popup.js`: toolbar management interface.

Run the dependency-free logic/background regression suite with Node.js 20 or newer:

```sh
node --test tests/core.test.cjs
```

For a store package, ZIP the **contents** of `extension/` so that `manifest.json` is at the archive root. Development tests and repository metadata are not needed in the package.

See [usage instructions](extension/README.md), [changelog](extension/CHANGELOG.md), and [verification scope](extension/VERIFICATION.md).

## Privacy and limitations

Read [the privacy policy](PRIVACY.md) for the local data stored and Twitch page content accessed. Permissions are limited to `storage`, `alarms`, and content-script access to `https://www.twitch.tv/*`.

Category matching depends on category text currently exposed by Twitch. Unknown categories remain visible. The extension changes supported cards, not direct channel access, playback, follows, subscriptions, or chat. Rules are saved per browser profile and do not sync across devices.

## Support and contributions

Read the [support guide](SUPPORT.md) for setup help and useful bug-report details.

Please [open an issue](https://github.com/raccooovl/twitch-snooze/issues) or email [support@perfsn.xyz](mailto:support@perfsn.xyz) with the extension version, browser version, what happened, and the relevant Twitch page type. Avoid posting passwords, cookies, private messages, or other sensitive information. Issues are public and processed by GitHub under its own privacy policy.

Bug fixes and focused improvements are welcome. Preserve normal channel-link behaviour, the six snooze choices, local-only data handling and minimal permissions. Include relevant regression checks with behaviour changes.

## License

[MIT](LICENSE). Twitch Snooze is independent and is not affiliated with or endorsed by Twitch. Third-party names and trademarks remain the property of their owners.
