# Twitch Snooze privacy

Updated 1 October 2026. Applies to Twitch Snooze 0.4.1 for Google Chrome and Microsoft Edge.

Twitch Snooze sends no data to the developer or any other server. It contains no analytics, telemetry, advertising, remote code, or external API calls.

It stores your selected channels' login/display name, snooze duration, selection/expiry time, category rules, streamer exceptions, whitelist entries (channel name and time added), and internal revision/Undo identifiers in `chrome.storage.local`. This is local browser-profile storage, not browser-account sync. It does not save the list of channels you follow or watch, chat messages, browsing history, cookies, credentials, IP addresses, or location.

The extension reads Twitch channel/category-card markup to identify streamers and their displayed categories and hide matching cards. When the manager is open, it requests the current card names and categories from the extension's own content scripts in open Twitch tabs. Those observations are transient and are not saved as browsing history. Only numeric tab IDs are kept in `chrome.storage.session`; the manager removes closed/unreachable tabs from that registry. It does not request a separate tabs/history permission or access other sites.

The website itself continues making its own normal requests; Twitch Snooze does not intercept them or modify your follows, subscriptions, chat, or playback.

Expired snoozes are deleted when the extension runs its expiry check, including snoozes temporarily overridden by the whitelist. Restore deletes an active snooze immediately; a per-channel Undo token may remain for up to ten minutes, capped by the original expiry. That token is then deleted automatically. Category rules, exceptions and whitelist entries remain until you remove them. Uninstalling the extension removes its local extension storage.

Permissions are limited to local storage, extension alarms, and a content script on `https://www.twitch.tv/*`. The only page-accessible extension asset is its UI stylesheet.

## Chrome Web Store Limited Use

Twitch Snooze follows the Chrome Web Store User Data Policy and its Limited Use requirements. Channel/category labels and your rules are used only to provide the hiding, snoozing, whitelist and management features described here. The extension does not transmit this data to the publisher or third parties, sell it, use it for advertising or profiling, or make it available for unrelated human review.

For support, you can open a public issue at https://github.com/raccooovl/twitch-snooze/issues. Information you choose to post there is processed by GitHub under its own policy. Do not include passwords, cookies, private messages or other sensitive information. This voluntary support channel is separate from the extension, which uploads nothing automatically.
