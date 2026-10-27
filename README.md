# 🎭 Tulpa Chat

Write proxied conversations and stories with your **Tupperbox** or **PluralKit** cast, in a web page instead of Discord. Type with the same brackets you use on Discord, and the message posts as that headmate, with their name, tag and avatar.

Everything stays in your browser (localStorage) unless you choose to sign in, which syncs your cast, stories and settings between devices. There's no build step: it's three static files, ready for GitHub Pages.

## Using it

1. **Import your cast.** On Discord, run Tupperbox's `tul!export` or PluralKit's `pk;export`, then load the JSON with **📁 Import**. You can also **＋ Add** speakers by hand, which works for people who don't use either bot.
2. **Type.** `k:hello` or `[hello]` posts as whoever owns those brackets. The most specific bracket wins, so `kat:` beats `k:`. Text without brackets posts as you (set your name and avatar in ⚙ Settings).
   - Click a name in the cast to **latch** them, so plain text posts as them. Click again, or click *Writer*, to unlatch.
   - `\text` skips the proxy once. `\\text` unlatches.
   - On a computer Enter sends and Shift+Enter starts a new line. On a phone, Enter starts a new line and the Send button posts. Change this in ⚙ Settings → Enter key. Ctrl/⌘+Enter always sends.
   - ↑ in an empty box edits your last message.
   - Discord markdown works: `*italic*`, `**bold**`, `__underline__`, `~~strike~~`, `||spoiler||`, `> quote`, `` `code` ``, `# heading`.
3. **Shape the story.** Hover a message (tap on touch screens) to **edit** (or double-click), **move** it up or down, **write after it**, or **delete** it (deleting can be undone). The *Stories* tab keeps as many separate stories as you like.
4. **Get it out.**
   - **📸 Capture**: a clean screenshot view at a set width. Tap messages to pick a range, then **Save PNG** or **Copy PNG**, or just snip the screen.
   - **⬇ Export**: a Markdown story, a Markdown chat log, a plain-text script, a standalone web page in the current theme, or a story file another Tulpa Chat user can import.
   - **⚙ Settings → Download backup**: everything, for moving browsers or devices.
5. **Sync between devices (optional).** Tap **☁ Sign in**, then *Create account* on the first device and *Sign in* on the others. Whatever each device already had is merged rather than overwritten: the newest version of each story and speaker wins, deletions carry across, and the same Tupperbox import on two devices folds into one cast. It syncs a few seconds after each change, when you come back to the tab, and every minute while the tab is open.

### Themes

Discord dark/light, Starship, Whisperer (matches the Starship Whisperer's Chart), Bubbles light/dark (Instagram-style, with your messages on the right) and Parchment (book-style prose). Each speaker can be set to the left or right side in the bubble themes.

## Notes and limits

- **Avatars hosted on Discord** (`cdn.discordapp.com/attachments/…`) use signed links that expire. When one breaks, the speaker shows coloured initials instead. Use *Upload avatar* in the speaker editor for a copy that never breaks; it's resized to 128px and stored locally.
- PNG capture uses [html2canvas](https://html2canvas.hertzen.com/) from cdnjs, loaded only when you capture. Tupperbox's avatar host doesn't allow other sites to copy its images, so for PNGs and web-page exports the avatars are fetched through the open-source [wsrv.nl](https://wsrv.nl/) image proxy. Only the avatar links go there, and only when you capture or export. You can turn this off in Settings, and avatars then show as initials.
- Browser storage is per browser and per device, and is usually limited to around 5 MB. Keep a backup.
- **Accounts** use [Skapi](https://www.skapi.com). Each account's data is one *private* record that only that account can read. It isn't end-to-end encrypted, so the service provider could read it in principle. There's no password reset yet, because accounts are created without email verification; keep a backup if you'd hate to lose access.
- If two devices edit the *same* story between syncs, the one saved last wins for that story. Different stories never clash.

## Roadmap

- **Shared stories:** two accounts writing into one story (see the design notes in the project history).
- Password reset via email verification.
- Custom themes, in place of the built-in theme presets.

## Hosting

GitHub Pages serves the repo root as-is. `.nojekyll` stops Jekyll from processing it.
