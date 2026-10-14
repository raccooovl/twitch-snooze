# Changes

## 0.6.1

- **Fixed: keywords for a tag didn't stay hidden.** A keyword such as `Nederlands` hid the streams with that tag for a moment, then they came back. Twitch only draws the tags that fit on a card, so once a card was hidden it had no tags left and the next check let it through. Twitch Snooze now remembers the tags it saw on each card (for the same streamer and title), so tagged streams stay hidden.
- **Profile pictures.** Rows in Hidden content (Streamers and Always show), the popup's lists and its In this tab card show the streamer's Twitch profile picture once Twitch Snooze has seen it on a page, with the coloured initials as before until then or if the picture can't load. Pictures are remembered only for streamers your rules mention, and deleted within 30 days once no rule mentions them. They aren't included in backups.
- The In this tab card's picture is now the intended 44 px, and its red live ring appears only when the channel is streaming.

Saved data is kept unchanged; the only new stored value is each remembered profile picture's address. Permissions are unchanged.

## 0.6.0

New look:

- Redesigned to look like part of Twitch ("Built-in"): Twitch's own colours, Inter type, menus and underline tabs, in light and dark themes. The popup and Backup page bundle Inter; on Twitch the extension uses the copy Twitch already loads.
- The moon menu opens beside the sidebar like Twitch's own menus, and every duration shows when the streamer comes back ("back Fri 16 Oct").
- "Whitelist" is now called **Always show**. Rows in Hidden content show initials, the reason and a **Show** button; a "⋯" menu holds Change how long, Always show and Open channel.
- The popup's **In this tab** card has **Snooze** and **Always show** buttons, or **Show** when the channel is hidden.

New:

- **Peek mode:** a toggle in Hidden content and the popup shows hidden items faded with a "Hidden" label instead of removing them. Their menu explains why they are hidden and offers Show. Peek stays on until you turn it off.
- **More places covered:** search results (live channels, offline channels, past videos and categories) and the homepage's featured carousel, which skips past a hidden streamer and is removed only if every featured stream is hidden. Video and clip lists were already covered and are now tested.
- **Translations:** Dutch, German, Spanish and Brazilian Portuguese, including the store name and summary. Dates follow your browser's regional format.

Saved data from 0.5.x is kept unchanged; the only new stored setting is whether Peek is on. Permissions are unchanged.

## 0.5.0

New:

- **Until I unhide:** a seventh duration that keeps a streamer hidden until you restore them. It never expires, and Restore, Undo and Change work as for timed snoozes.
- **Keywords:** hide streams whose title or tags contain a word or phrase (for example `drops`, `reruns`, `24/7` or a tag such as `DropsEnabled`). Matching is by whole word, ignores case and punctuation, and also works for scripts written without spaces. The Streamers list explains keyword matches, Restore adds an exception for that streamer, and the whitelist overrides keywords. Sidebar rows have no titles, so they are hidden only when the same stream's card on the page matches.
- **Snooze the channel you're watching:** on a channel page the toolbar popup shows an "In this tab" card with the full Hide menu (durations, category options, whitelist), or Restore when the channel is already hidden. No new permissions.
- **Backup:** a Backup page (from the popup footer) downloads your snoozes, category and streamer rules, keywords and whitelist as a JSON file, and restores one by adding to or replacing your current rules, showing what the file contains first.

Fixes:

- Undo now covers every change: hiding a category, streamer category rules, exceptions, keywords, whitelist changes, and a Restore that also changed category rules.
- Display names are no longer stuck in lowercase. Channels added by typing a name are updated to the name Twitch shows once they appear on a page, and Restore messages use the display name.
- Group streams ("SmallAnt +3") are labelled with the streamer's name instead of the avatar's "SmallAnt and Moarf23" text.
- Category rules keep working when Twitch's display language changes or a category is renamed: rules now remember the category's web address and learn translated names, and existing rules pick these up automatically.
- Faster Browse pages: every control shares one stylesheet instead of loading `ui.css` separately, and each page scan reads the page and its layout once. On live Twitch, scan time while a Browse page loads dropped from about 230–250 ms to about 50–60 ms, and the slowest single scan from 104–123 ms to 21–27 ms.
- `ui.css` is no longer exposed to Twitch pages (`web_accessible_resources` removed), so pages cannot use it to detect the extension. Menus no longer wait for a stylesheet to load before appearing.
- The manager's four tabs fit narrow windows, and popup confirmations stay in view while scrolling.

Saved snoozes, rules, exceptions and whitelist entries from earlier versions are kept unchanged. Permissions are unchanged (`storage`, `alarms`, and Twitch site access).

## 0.4.3

- Add an optional **Leave a review** link to the toolbar popup footer. It opens the Chrome Web Store reviews or the Microsoft Edge Add-ons listing for the installed store copy, in a new tab. No reminders, tracking or permissions are added.

## 0.4.2

- Rename the store listing to "Twitch Snooze: Hide Channels & Categories" and update its description. Features and data handling are unchanged from 0.4.1.

## 0.4.1

- Rename the sidebar entry and manager to Hidden Content.
- Open the manager beside the sidebar in a 420-pixel floating panel, clamped to the viewport; individual snooze menus remain inline.
- Add a clear heading, section counts and consistent Streamers / Categories / Whitelist navigation.
- Increase manager text and row readability, with a fixed header and one scrolling content area.
- Adapt to narrow and short windows; Escape and Close return focus to the opener, and clicking outside dismisses the manager.
- Update the toolbar popup to match the new hierarchy and naming.
- Preserve all saved settings and existing permissions.

## 0.4.0

- Add a global whitelist that keeps selected streamers visible across every category, overriding their snoozes and category rules.
- Add streamers by name/link, from their moon menu, or with a star beside a hidden streamer.
- Keep existing rules saved while whitelisted and resume them when the streamer is removed; dormant snoozes still expire normally.
- Redesign the manager with compact Hidden, Categories and Whitelist tabs, neutral surfaces and restrained accent colour.
- Replace tall cards with compact rows, shortened dates with exact times on hover, and collapsible category exceptions.
- Bound the sidebar manager's height with one content scroller, and keep its header, tabs and search visible.
- Use a compact two-column duration menu while preserving all six presets and keyboard navigation.
- Avoid unnecessary writes and redraws when Chromium returns stored object keys in a different order.
- Preserve stored settings, normal browser link behavior and existing permissions.

## 0.3.0

- Hide a streamer only while they play a selected category, with automatic return when Twitch updates their category.
- Hide entire categories from sidebar rows, stream cards and Browse category tiles.
- Add Hidden streamers and Categories views to the sidebar manager and toolbar popup.
- Show every saved streamer rule and current category matches across open Twitch tabs, with the reason and one-click Restore.
- Keep favourite streamers visible through category-specific exceptions; manage exceptions without deleting the category rule.
- Restore overlapping timed and category rules together in one atomic change.
- Handle Twitch's native collapsed-sidebar markup without duplicate controls.
- Keep browser right-click, the six duration choices, existing snoozes and permissions unchanged.
- Bound requests to unresponsive tabs so the manager cannot block new saves. No external APIs or saved browsing history.

## 0.2.0

- Restore normal right-click and new-tab behavior on Twitch channel links.
- Use a clear moon button, including in collapsed sidebars.
- Add Snooze controls to discovery stream cards.
- Add search, visible return dates, and duration changes to the manager.
- Wait for styles before showing/focusing menus; support arrow keys, Home/End, Escape and short windows.
- Keep controls working when Twitch reuses or replaces channel rows and loads its sidebar after the extension.
- Reconcile cleared storage immediately, preserve keyboard focus after Restore, and lock submission controls while saving.
- Allow Restore Undo after unrelated channel changes, while protecting newer changes to the same channel. Undo markers expire within ten minutes.
- Preserve existing snoozes and the original six duration choices with no additional permissions.

## 0.1.0

- Initial Chrome/Edge release with inline snoozing, automatic expiry, cross-tab persistence, Undo, and popup management.
