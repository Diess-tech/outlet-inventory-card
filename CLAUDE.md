# Outlet Inventory Card — notes for Claude

Lovelace custom card (single file, no build step): `outlet-inventory-card.js`.
Counts power strips / smart plugs / multi-plugs / adapters by TYPE and shows what is free.

## How it works
- Data = Home Assistant To-do lists (Local To-do), one list per category, one item per type.
- Item description holds the counts as `Key: value` lines. Italian and English keys are both parsed
  (`Totale/Total`, `In uso/In use`, `Collegamento/Connection`, `Attacco/Plug`, `Posti/Sockets`,
  `Lunghezza/Length`, `Note/Notes`). Writes use the keys of the HA user's language.
- Item `completed` = nothing free (so the list state counts types that still have free pieces).
- Live data via websocket `todo/item/subscribe` (fallback `todo/item/list`); writes via
  `todo.add_item` / `todo.update_item` / `todo.remove_item`.
- UI texts: `I18N` object (it, en). Styling uses HA theme variables only.

## Owner's setup (Davide)
- Talk to the owner in simple Italian, without assuming technical jargon.
- Dashboard `pc-claude`, view `prese`: one full-width section with this card.
- Lists: `todo.prese_smart`, `todo.ciabatte`, `todo.multiprese`, `todo.riduttori`.
- The card is currently installed in his HA as an INLINE dashboard resource (id `a7ede861051642aab2c80cb7bfc1eee9`),
  not from this repo. After changing the JS, either update that resource or switch it to HACS / `/local/`.
- There is also a twin page on claude.ai (artifact "Prese & ciabatte di casa") using the same lists.

## Releasing
- Bump `OIC_VERSION` in the JS, commit, tag `vX.Y.Z`, create a GitHub release (HACS reads releases).
- Keep `hacs.json` filename in sync with the JS file name.
- On every published release a workflow (`.github/workflows/allega-alla-release.yml`) attaches `outlet-inventory-card.js`
  to it, so HACS downloads count. It can also be run by hand for an existing tag (Actions > Run workflow).
  Owner creates the release by hand (Claude cannot create tags). After a release, in HACS: ⋮ > Update information.

## Commits
- Owner does not want Claude shown as contributor: do NOT add `Co-Authored-By` or `Claude-Session` trailers,
  and commit with the owner's identity (`Davide Sanna <Diess-tech@users.noreply.github.com>`).
- Donation links: PayPal `paypal.me/diesstech`, Ko-fi `ko-fi.com/diesstech`, Buy Me a Coffee `buymeacoffee.com/diesstech` (in `.github/FUNDING.yml` and README).
