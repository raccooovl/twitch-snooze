# Twitch Snooze

Snooze Twitch streamers, hide categories and keywords, or hide a streamer only while they play a particular game. Your rules stay in this browser and never change your follows.

## What's new in 0.6.1

- **Tag keywords stay hidden:** a keyword for a tag, such as `Nederlands`, no longer lets those streams reappear after a moment.
- **Profile pictures:** Hidden content and the popup show streamers' Twitch profile pictures once Twitch Snooze has seen them on a page.

## New in 0.6.0

- **A new look that fits Twitch:** Twitch's own colours, type and menus, in light and dark themes. Every duration shows when the streamer comes back.
- **Peek mode:** show hidden items faded with a "Hidden" label instead of removing them.
- **More places:** search results and the homepage's featured carousel, as well as video and clip lists.
- **Languages:** English, Dutch, German, Spanish and Brazilian Portuguese, chosen from your browser's language.
- "Whitelist" is now called **Always show**.

See `CHANGELOG.md` for details.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder, the one that contains `manifest.json`.
4. Refresh open Twitch tabs. Pin Twitch Snooze to the toolbar for quick access.

The ZIP is a release package. Extract it first to use **Load unpacked**.

## Use

Click the **moon** beside a channel in Twitch's sidebar (it also works when the sidebar is collapsed), or hover over a stream, video, clip or search result and click **Snooze**. A menu opens beside it with **Today**, **24 hours**, **3 days**, **1 week**, **2 weeks**, **1 month** and **Until I unhide**, each showing when the streamer comes back. Today ends at your local midnight; one month returns on the same date next month, or the last day of a shorter month. Until I unhide has no end date.

The streamer disappears from the sidebar, Browse and category pages, video and clip lists, search results and the homepage carousel in every open Twitch tab. Your follow and subscription stay as they are. Playing streams, chat and the channel page itself are not blocked. When the homepage carousel features someone you've hidden, it moves on to the next featured stream; if every featured stream is hidden, the carousel is removed.

Right-click, Ctrl-click and middle-click on channel links keep their normal behaviour.

Every change shows a confirmation with **Undo**. Undo refuses to overwrite a newer change to the same streamer, category or keyword.

## Hidden content

Click **Hidden content** near the top of Twitch's sidebar. The panel opens beside the sidebar with four sections:

Rows show the streamer's Twitch profile picture once Twitch Snooze has seen it on a page (in the sidebar, a stream card or the homepage), or their initials until then.

- **Streamers:** everyone you've snoozed or hidden in a category, plus streams from your open Twitch tabs that a hidden category or keyword catches. Each row says why and when they come back. **Show** brings them back (for a category or keyword match, it lets that streamer through). The **⋯** menu offers **Change how long**, **Always show** and **Open channel**.
- **Categories:** hide a category by name. Expand a category's "let through" count to hide a streamer there again. **Show** removes the rule.
- **Keywords:** words or phrases to hide (see below).
- **Always show:** streamers who stay visible everywhere.

Close the panel with Escape, its close button or a click outside. The footer links to **Backup**.

## Peek

Turn on **Peek** in Hidden content or the toolbar popup to see what your rules are catching. Hidden streams, rows, tiles and search results appear faded with a **Hidden** label instead of disappearing. Opening the menu on a faded item explains why it's hidden and offers **Show** (and a different duration for snoozes). Peek stays on in every Twitch tab until you turn it off.

## The channel you're watching

On a channel page (including its Videos, Clips and About pages), open the toolbar popup. The card at the top names the channel and what it's streaming, with **Snooze** (durations and the two category options) and **Always show**. If the channel is hidden, the card says why and offers **Show**.

## Keywords

Add a word or phrase under **Keywords**. Streams whose title or tags contain it are hidden, for example `drops` (which also matches the `DropsEnabled` tag), `reruns`, `24/7` or a language tag such as `Nederlands`.

- Matching uses whole words and ignores case and punctuation, so `drops` matches "[DROPS]" but not "raindrops". Chinese, Japanese, Korean and Thai keywords match anywhere in the text.
- Keywords apply to stream cards, video and clip titles, search results and the featured carousel. Twitch's sidebar shows no titles or tags, so a sidebar row is hidden by a keyword only when the same stream's card on the page matches.
- Each keyword shows how many streams it hides in your open tabs. **Show** on one of those streamers lets them through.
- Streamers you always show stay visible.

## Category rules

When a streamer's category is known, the moon menu offers:

- **Hide while they play [category]:** hides that streamer only while they're in that category. The rule stays saved for next time.
- **Hide [category] everywhere:** hides matching sidebar rows, stream cards, Browse tiles and search results. You can also hover a Browse tile and click **Hide**, or type the name under **Categories**.

Rules remember the category's web address (for example `/directory/category/just-chatting`), which is the same in every language, and learn translated names as Twitch shows them, so they keep working if you switch Twitch's language. In Twitch's collapsed sidebar the category isn't shown; category rules apply there when a matching stream card is on the same page.

## Always show

Add a channel name or link under **Always show**, or choose **Always show** in a streamer's menu. They stay visible everywhere, over snoozes, category rules and keywords. Their saved rules are paused, not deleted, and apply again when you remove them. Snoozes still expire normally while paused.

## Backup

Your rules are stored only in this browser profile and are deleted if you uninstall the extension. Click **Backup** in the popup or the Hidden content panel:

- **Download backup file** saves your snoozes, category and streamer rules, keywords and always-shown streamers as a `.json` file. Expired snoozes and Undo history are left out.
- **Restore from a backup** shows what a file contains first. **Add to my rules** merges it (a longer snooze wins, exceptions are combined); **Replace my rules** asks for confirmation, then replaces everything.

Open Twitch tabs update immediately. Nothing is uploaded.

## Languages

Twitch Snooze follows your browser's language: English, Dutch (Nederlands), German (Deutsch), Spanish (Español) and Brazilian Portuguese (Português). Other languages use English. Dates and times follow your browser's regional format.

## Permissions

- **Storage:** keeps your rules and whether Peek is on, in this browser. Session storage keeps only the IDs of open Twitch tabs for the manager.
- **Alarms:** ends snoozes on time while the extension is idle.
- **Twitch site access:** adds the controls and hides matching items on `https://www.twitch.tv/` only.

No analytics, remote code or extra site access. The only requests Twitch Snooze makes are for streamers' profile pictures, from Twitch's own image server (`static-cdn.jtvnw.net`), sent without a referrer. No extension file is exposed to web pages. The popup's channel card asks the Twitch tab's own content script which channel it shows, so it doesn't need the tabs permission. See `PRIVACY.md`.

## Update an unpacked installation

Open your browser's Extensions page, click **Reload** on Twitch Snooze, then refresh open Twitch tabs. If you loaded it from a different folder, copy the new files into that folder first: loading a new folder creates a separate extension with empty storage. Version 0.6.1 keeps all saved snoozes, rules, keywords and always-shown streamers.

Twitch Snooze is an independent browser extension and is not affiliated with Twitch. The Inter typeface is used under the SIL Open Font License (`fonts/Inter-OFL.txt`).

## Source and support

The full source is available under the MIT license at https://github.com/raccooovl/twitch-snooze. Report problems through that repository's Issues page. Please avoid including private account information in public issues.
