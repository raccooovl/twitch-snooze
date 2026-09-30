# Changes

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
