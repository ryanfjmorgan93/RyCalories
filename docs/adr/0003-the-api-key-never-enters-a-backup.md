# The API key never enters a backup

The Anthropic API key is kept in `localStorage` under its own key, not in the Dexie Settings row where every other setting lives. The Settings row is copied into the JSON export, the automatic backups in Documents/Iron and the raw recovery dump, any of which the owner may share or leave on shared storage; a key in there would leak with them. The cost is that a restore on a new phone does not bring the key back, and the owner pastes it again. Tests assert the key never appears in any export.
