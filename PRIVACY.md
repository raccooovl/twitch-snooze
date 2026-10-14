# Twitch Snooze privacy

Updated 14 October 2026. Applies to Twitch Snooze 0.6.1 for Google Chrome and Microsoft Edge.

Twitch Snooze sends no data to the developer. It contains no analytics, telemetry, advertising, remote code, or external API calls. Its only network requests are for Twitch profile pictures, described below.

It stores your selected channels' login/display name, snooze duration, selection/expiry time, category rules (category name, its Twitch web address and any translated names Twitch has shown), keywords you add, streamer exceptions, always-shown streamers (channel name and time added), the Twitch profile-picture address of streamers your rules mention (and when it was last seen), whether Peek mode is on, and internal revision/Undo identifiers in `chrome.storage.local`. This is local browser-profile storage, not browser-account sync. It does not save the list of channels you follow or watch, chat messages, browsing history, cookies, credentials, IP addresses, or location.

The extension reads Twitch's sidebar, stream, video, clip, search-result and homepage-carousel markup to identify streamers, their displayed categories, and stream titles and tags (for keyword matching), and hides or fades matching items. When the homepage carousel features a hidden streamer, it presses Twitch's own "next" button to move on. When the manager is open, it requests the current card names, categories, titles and tags from the extension's own content scripts in open Twitch tabs. When you open the toolbar popup on a Twitch channel page, it asks that tab's content script which channel it shows. Those observations are transient: titles and tags are never saved, and nothing is saved as browsing history. Display names, profile-picture addresses and category web addresses seen on Twitch are saved only to complete rules you already created. A remembered profile-picture address is deleted within 30 days once no rule mentions that streamer. Only numeric tab IDs are kept in `chrome.storage.session`; the manager removes closed/unreachable tabs from that registry. It does not request a separate tabs/history permission or access other sites.

To show streamers' profile pictures, the popup and the Hidden content panel load those images from Twitch's own image server (`static-cdn.jtvnw.net`), the same server Twitch pages use for them. These requests use a no-referrer policy, so the extension does not send the address of the Twitch page you are viewing. Only addresses of Twitch profile images are accepted. As with ordinary HTTPS image requests, Twitch’s image server receives the image address, your IP address and standard browser request metadata. The extension does not send your snooze rules, keywords, browsing history or credentials to the developer or include them in the image address.

The website itself continues making its own normal requests; Twitch Snooze does not intercept them or modify your follows, subscriptions, chat, or playback.

Expired snoozes are deleted when the extension runs its expiry check, including snoozes temporarily overridden by the whitelist. Restore deletes an active snooze immediately; a per-channel Undo token may remain for up to ten minutes, capped by the original expiry. That token is then deleted automatically. Snoozes set to Until I unhide, category rules, keywords, exceptions and always-shown streamers remain until you remove them. Uninstalling the extension removes its local extension storage.

Permissions are limited to local storage, extension alarms, and a content script on `https://www.twitch.tv/*`. No extension files are accessible to web pages. The Inter font used by the popup and Backup page is bundled with the extension, so no fonts are downloaded.

The optional Backup page creates a JSON file of your rules on your own computer when you click Download, and reads a backup file only when you choose one. The file is never uploaded.

## Chrome Web Store Limited Use

Twitch Snooze follows the Chrome Web Store User Data Policy and its Limited Use requirements. Channel/category labels and your rules are used only to provide the hiding, snoozing, whitelist and management features described here. The extension does not transmit this data to the publisher or third parties, sell it, use it for advertising or profiling, or make it available for unrelated human review.

For support, you can open a public issue at https://github.com/raccooovl/twitch-snooze/issues. Information you choose to post there is processed by GitHub under its own policy. Do not include passwords, cookies, private messages or other sensitive information. This voluntary support channel is separate from the extension, which uploads nothing automatically.

---

## Archived policy for earlier versions

The previous published policy is preserved below for earlier installations.

### Previous Twitch Snooze privacy policy

Updated 1 October 2026. Applies to Twitch Snooze 0.4.1 for Google Chrome and Microsoft Edge.

Twitch Snooze sends no data to the developer or any other server. It contains no analytics, telemetry, advertising, remote code, or external API calls.

It stores your selected channels' login/display name, snooze duration, selection/expiry time, category rules, streamer exceptions, whitelist entries (channel name and time added), and internal revision/Undo identifiers in `chrome.storage.local`. This is local browser-profile storage, not browser-account sync. It does not save the list of channels you follow or watch, chat messages, browsing history, cookies, credentials, IP addresses, or location.

The extension reads Twitch channel/category-card markup to identify streamers and their displayed categories and hide matching cards. When the manager is open, it requests the current card names and categories from the extension's own content scripts in open Twitch tabs. Those observations are transient and are not saved as browsing history. Only numeric tab IDs are kept in `chrome.storage.session`; the manager removes closed/unreachable tabs from that registry. It does not request a separate tabs/history permission or access other sites.

The website itself continues making its own normal requests; Twitch Snooze does not intercept them or modify your follows, subscriptions, chat, or playback.

Expired snoozes are deleted when the extension runs its expiry check, including snoozes temporarily overridden by the whitelist. Restore deletes an active snooze immediately; a per-channel Undo token may remain for up to ten minutes, capped by the original expiry. That token is then deleted automatically. Category rules, exceptions and whitelist entries remain until you remove them. Uninstalling the extension removes its local extension storage.

Permissions are limited to local storage, extension alarms, and a content script on `https://www.twitch.tv/*`. The only page-accessible extension asset is its UI stylesheet.

### Previous Chrome Web Store Limited Use

Twitch Snooze follows the Chrome Web Store User Data Policy and its Limited Use requirements. Channel/category labels and your rules are used only to provide the hiding, snoozing, whitelist and management features described here. The extension does not transmit this data to the publisher or third parties, sell it, use it for advertising or profiling, or make it available for unrelated human review.

For support, you can open a public issue at https://github.com/raccooovl/twitch-snooze/issues. Information you choose to post there is processed by GitHub under its own policy. Do not include passwords, cookies, private messages or other sensitive information. This voluntary support channel is separate from the extension, which uploads nothing automatically.
