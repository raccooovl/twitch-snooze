# Twitch Snooze

Snooze Twitch streamers, hide categories, or hide a streamer only while they play a particular category. Your rules stay on this browser without changing your follows.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder, which contains `manifest.json`.
4. Refresh open Twitch tabs. Pin Twitch Snooze to the browser toolbar if you want quick access to the manager.

The ZIP is a release package. Extract it first to use **Load unpacked**.

## Use

Click the **moon** beside a channel in Twitch's sidebar, including when the sidebar is collapsed. Or hover over a stream card and click **Snooze**. The sidebar opens an inline menu; collapsed sidebars and stream cards use a nearby menu. Choose **Today**, **24 hours**, **3 days**, **1 week**, **2 weeks**, or **1 month**. Today ends at your local midnight; one month returns on the corresponding calendar date, clamped to the last day of shorter months.

The channel disappears from sidebar and discovery cards across open Twitch tabs. Its follow/subscription is preserved. Playing streams, chat messages, and direct channel pages are not blocked.

Right-click, Ctrl-click, and middle-click on channel links keep their normal browser behavior, including opening channels in another tab.

Click **Undo** after a timed snooze change, or **Hidden Content** near the top of the sidebar to open the manager beside it. The floating panel has **Streamers**, **Categories**, and **Whitelist** sections with counts. It stays within your window and keeps the sidebar in place. Close it with Escape, its close button, or a click outside. Compact return dates show their exact time on hover. The toolbar popup uses the same section names, accepts a channel name or Twitch link and offers **Change** to choose a new duration. Changing one channel does not block Undo for an unrelated channel; Undo still protects newer changes to the same channel.

## Whitelist

Open **Whitelist** in the sidebar manager or toolbar popup and add a channel name or Twitch link. You can also click the **star** beside a hidden streamer, or **Always show this streamer** in their moon menu.

Whitelisted streamers stay visible in every category, overriding timed snoozes, streamer-specific rules and whole-category rules. Existing rules are paused rather than deleted; removing someone from the whitelist makes those rules apply again. Timed snoozes still expire normally while paused. To create a new snooze for a whitelisted streamer, remove them from the whitelist first.

Category exceptions still work independently: they allow a streamer in one category, while the whitelist allows them everywhere.

## Category rules

When a streamer's category is available, the moon menu offers:

- **Hide here until they switch:** hide that streamer only in the category shown in the menu. They appear again when Twitch updates their category. The rule stays saved for their next visit to that category.
- **Hide this category everywhere:** hide matching sidebar rows, stream cards, and Browse category tiles. Hover over a Browse category tile to hide it directly, or open **Categories** in the manager and enter its name as shown on Twitch.

Category rules stay until you remove them. In **Streamers**, Restore removes a streamer's saved rules and timed snooze. If a whole-category rule also hides them, Restore adds an exception for that streamer in the currently matched categories. In **Categories**, expand a rule's exception count and remove an exception to hide that streamer again, or click **Show** to remove the whole-category rule.

**Streamers** includes saved timed snoozes and streamer-specific rules, plus category matches currently loaded in open Twitch tabs. Whitelisted streamers appear in their own tab. The extension does not fetch a catalogue of every Twitch streamer. A saved streamer-specific rule remains listed even when that streamer is currently playing something else. The sidebar badge combines the streamers and hidden categories shown in the manager; each section shows its own count.

Category matching reads Twitch's current card text. Unknown categories remain visible. In the native collapsed sidebar Twitch removes category text; category filtering there needs a current matching stream card on the same page, or an expanded sidebar. Timed snoozes still work when collapsed. Category names are matched ignoring case, spacing and punctuation; use the category name displayed in your Twitch language.

The menus support keyboard activation, arrow keys, Home/End, and Escape. They follow Twitch's theme, stay within the window, and scroll when space is limited.

Snoozes survive browser restarts. If the browser is closed when a snooze expires, it is cleared when the extension next starts. No server or account is needed.

## Permissions

- **Storage:** saves channel snoozes, category rules, exceptions and your whitelist locally; session storage keeps only extension-enabled Twitch tab IDs for the manager.
- **Alarms:** clears expired snoozes while the extension worker is idle.
- **Twitch site access:** adds the menu and hides matching channel cards on `https://www.twitch.tv/` only.

There are no analytics, network APIs, remote scripts, or additional site permissions. See `PRIVACY.md`.

## Update an unpacked installation

The release folder remains `twitch-snooze`. If you loaded this folder previously, open your browser's Extensions page and click **Reload** on Twitch Snooze, then refresh your open Twitch tabs. Existing snoozes are preserved. If you installed a copy elsewhere, replace that copy with the new ZIP contents before reloading.

Version **0.4.1** introduces the **Hidden Content** floating manager with a wider layout, clear section counts and readable rows. Existing snoozes, category rules, exceptions, whitelist and the six duration choices are preserved. No additional permissions are requested.

Twitch Snooze is an independent browser extension and is not affiliated with Twitch.

## Source and support

The full source is available under the MIT license at https://github.com/raccooovl/twitch-snooze. Report problems through that repository's Issues page. Please avoid including private account information in public issues.
