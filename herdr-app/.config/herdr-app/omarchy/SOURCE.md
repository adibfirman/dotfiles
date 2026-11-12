# Omarchy layout for Herdr

Copied from https://github.com/shafiqimtiaz/herdr-omarchy at commit `168840b` (2026-11-12), after a read-only review of every file.

Licenses:
- `LICENSE-omarchy` is the license file that repo ships (Omarchy, MIT).
- `mods/omarchy-tabs/` keeps its `NOTICE` and `LICENSE-APACHE` (adapted from Herdr's tabs mod, Apache 2.0).
- `mods/omarchy-changes/` and `mods/omarchy-files/` keep `CHARMED-LICENSE.md` (MIT).

Changes from upstream:
- Left out: `omarchy-mod-manager`, `omarchy-ai-usage`, `omarchy-toast`, `patches/`, the tests, and the repo's `keys.json` (its `layout:omarchy` section is merged into `keys.json` by hand).
- `omarchy-bar`: no updater (`update.js` removed), no browser button, no zoom border.
- `omarchy-chrome`: no Mods row.
- `omarchy-tabs`: no reopen scan on macOS.
- `layouts/omarchy.json`: the `agent-notify` toast, the `copy-toast` block, the Kode Mono font, and `claude-usage` in place of `omarchy-ai-usage`.

To update: diff a fresh clone against these files, review the changes, then copy them by hand.
