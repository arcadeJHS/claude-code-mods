# 🔖 Bookmarks for Claude Code

**Bookmark any part of a Claude Code conversation and jump straight back to it.**

In a long session (lots of prompts, replies and code edits), finding something said an hour ago means scrolling up through the transcript for a long time. This mod gives you bookmarks, as in a browser or an e-book reader:

1. **Mark** a message, or just the few lines you care about.
2. It's added to a **Bookmarks pane** that docks beside the conversation, like the diff panel does.
3. Click **Go to** and the transcript **scrolls back to that exact message**, so you can pick up from there.

You can keep as many bookmarks as you like. Each one has its own **Delete** button, and they're saved with the session, so they come back when you resume it.

```
 ┌─ conversation ──────────────────────────────────┐ ┌─ Bookmarks ───────────────────────┐
 │                                                 │ │ [+ Bookmark selection] [Clear all]│
 │ > how should we cache the API responses?        │ │                                   │
 │                                                 │ │ claude · 14:32                    │
 │ ⏺ Two options: an in-memory LRU, or…        ★   │ │ Two options: an in-memory LRU, or │
 │                                                 │ │ a Redis layer in front of…        │
 │ ⏺ Edit(src/api/cache.ts)                    🔖  │ │ [ Go to ] [ Delete ]              │
 │   ⎿ Added 24 lines                              │ │                                   │
 │                                                 │ │ auth idea · selection · 15:07     │
 │                                                 │ │ refresh the token 60s before it   │
 │                                                 │ │ expires, not after the 401        │
 │                                                 │ │ [ Go to ] [ Delete ]              │
 └─────────────────────────────────────────────────┘ └───────────────────────────────────┘
        🔖 appears when you hover a message · ★ marks the ones already bookmarked
```

---

## Contents

- [What you can do](#what-you-can-do)
- [Requirements](#requirements)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [Commands](#commands)
- [How bookmarks are kept](#how-bookmarks-are-kept)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Development](#development)
- [License](#license)

---

## What you can do

| | |
|---|---|
| **Bookmark a whole message** | Hover any message (your prompt, Claude's reply, or a tool/edit row like `Edit(src/x.ts)`) and click the 🔖 that shows up at its top right. |
| **Bookmark just some text** | Select a few lines with the mouse, then click **+ Bookmark selection** in the pane, or type `/bookmark`. Only the text you selected is kept. |
| **Give it a name** | `/bookmark auth idea` saves the selection under the label *auth idea*. |
| **Jump back** | Click **Go to** on a bookmark and the conversation scrolls so that message sits at the top. |
| **See what's bookmarked** | Bookmarked messages keep a small **★** at their top right. |
| **Delete** | Each bookmark has its own **Delete** button. **Clear all** removes every bookmark in the session. |
| **Keep them** | Bookmarks are saved with the session and come back on `claude --resume` / `claude --continue`. |

---

## Requirements

- **Claude Code with plugin function hooks.** Tested on **2.1.291**. The hooks API is in early access and may change between releases.
- **Fullscreen terminal mode.** Hover marks, mouse selection and scroll-to-message all need it, because the classic "main screen" mode has no mouse tracking and leaves scrolling to your terminal. Turn it on in either of these ways:
  - add `"tui": "fullscreen"` to `~/.claude/settings.json`, or
  - start Claude Code with `CLAUDE_CODE_NO_FLICKER=1 claude`.

  Inside **tmux**, Claude Code uses the main screen by default, so you need one of the two settings above there too.
- **A wide enough window** for the pane to dock *beside* the conversation (110+ columns). In a narrower window the pane opens above the prompt instead, and everything still works.

---

## Install

### From GitHub (recommended)

This mod lives in [arcadeJHS/claude-code-mods](https://github.com/arcadeJHS/claude-code-mods). That repository is a plugin *marketplace*: it has a `.claude-plugin/marketplace.json` at its root that lists `bookmarks`. In a Claude Code session, type:

```
/plugin install bookmarks --marketplace arcadeJHS/claude-code-mods
```

Then:
1. answer **`y`** when asked to add the marketplace,
2. press **Enter** to pick the **user** scope (the mod is then active in every session).

You should see `Installed bookmarks. Plugin is now active.` and can start bookmarking right away.

### From a local folder

Clone the repository, then add it as a marketplace and install from it:

```bash
git clone https://github.com/arcadeJHS/claude-code-mods.git
claude plugin marketplace add ./claude-code-mods   # the folder holding .claude-plugin/marketplace.json
claude plugin install bookmarks@matteo-mods
```

A plugin installed this way runs **from that folder**, not from a copy. After you edit its files, run `/reload-plugins` in your session to load the changes.

### Just try it, without installing

```bash
claude --plugin-dir ./claude-code-mods/bookmarks
```

This loads it for that session only, and reloads it whenever you save a file in the folder.

---

## How to use it

### 1. Bookmark a message

Move the mouse over any message in the conversation. A **🔖** appears at the right end of its first line. Click it.

- The **Bookmarks** pane opens, with the new bookmark at the top.
- A short note confirms it: *Bookmarked: claude*.
- From then on the message shows a **★**, so you can tell it's bookmarked while you scroll.

Clicking ★ on a message that's already bookmarked doesn't add it twice. It just brings the pane up.

### 2. Bookmark a selection

Sometimes one sentence matters more than the whole reply.

1. **Select** the text with the mouse, as if you were going to copy it.
2. Then either:
   - click **+ Bookmark selection** at the top of the pane, or
   - type **`/bookmark`**, or **`/bookmark some label`** to name it.

The bookmark shows the selected text and is labelled `… · selection`. You can do this even while Claude is still answering.

> If your selection spans **several messages**, the bookmark is still saved (you keep the text), but it has no single message to jump to, so **Go to** just tells you so.

### 3. Jump back

Click **Go to** on any bookmark. The conversation scrolls until that message is at the top of the screen.

### 4. Clean up

- **Delete** removes one bookmark.
- **Clear all** removes every bookmark in this session.

### Opening and closing the pane

- **`/bookmarks`** opens the pane at any time.
- Close it with the pane's close mark, or **ctrl+x x**. Your bookmarks are kept.
- When you resume a session that has bookmarks, the pane opens by itself if the window is wide enough.

---

## Commands

| Command | What it does |
|---|---|
| `/bookmarks` | Opens the Bookmarks pane. |
| `/bookmark [label]` | Bookmarks the text currently selected with the mouse, optionally under `label`. |

Both commands work immediately, even while Claude is in the middle of a turn.

---

## How bookmarks are kept

- **Per session.** Each conversation has its own list.
- **Saved as you go.** Every add or delete is saved straight away in the plugin's own storage (Claude Code's per-plugin store, not your project files).
- **Restored on resume.** `claude --resume` / `--continue` brings back that session's bookmarks.
- **`/clear` starts fresh.** It begins a new conversation, so the list empties. The old conversation keeps its bookmarks for when you resume it.
- **Limits** (so storage stays small):
  - up to **200 bookmarks** per session,
  - up to **2,000 characters** of text per bookmark,
  - the **50 most recent sessions** with bookmarks are kept; older ones are dropped.

Nothing is sent anywhere, and the model never reads your bookmarks. They only change what you see on screen.

---

## Troubleshooting

**I don't see the 🔖 when I hover a message.**
You're probably on the main screen rather than fullscreen. See [Requirements](#requirements). Inside tmux, fullscreen is off by default.

**`/bookmark` says "Nothing is selected".**
Select the text with the mouse *first*, then run the command. The selection is remembered until you select something else or run your next prompt.

**"Can't scroll to that message (…). Its text is on the clipboard."**
The message is no longer part of the drawn conversation, for example after `/compact`. The mod copies the bookmarked text to your clipboard so you can still use it.

**The pane opens above the prompt instead of on the side.**
The window is narrower than about 110 columns. Widen it and the pane docks beside the conversation.

**Nothing happens at all.**
Check that the mod is loaded with `claude plugin list`, or start with `claude --debug`. If a hook fails, Claude Code writes a line naming the `bookmarks` plugin and the reason.

---

## Known limitations

- **Fullscreen only** for hover, selection and jumping. In main-screen mode the mod stays out of the way and draws nothing on messages.
- **Jumping needs the message to still be in the conversation view.** After a `/compact`, older messages are summarised, so their bookmarks can no longer jump (you get the text on the clipboard instead).
- **Grouped tool rows.** When several reads or searches are folded into one group row, the group has no 🔖 of its own. Bookmark the reply next to it, or select the text.
- **Early-access API.** Plugin function hooks are new in Claude Code and may change in future releases.

---

## Development

```
bookmarks/
├── .claude-plugin/
│   └── plugin.json          # name, version, description, type contract
├── hooks/
│   ├── hooks.json           # points Claude Code at register.tsx
│   └── register.tsx         # the whole mod: hover marks, pane, commands, storage
├── types/
│   └── index.d.ts           # the shape of the state the mod keeps
├── tests/
│   └── bookmarks.test.tsx   # runs against Claude Code's own engine
├── tsconfig.json            # extends the types Claude Code writes on load
└── README.md
```

**How it works, briefly**

- It hooks the drawing of each transcript row (`AssistantMessage`, `UserMessage`, `ToolUse`). It keeps Claude Code's own drawing of the row and adds a small hover-revealed button on top, which doesn't shift the layout.
- `$.ui.selection()` gives the selected text and the message it belongs to.
- `$.ui.scroll({ to: { requestId } })` scrolls the conversation to a message.
- The list lives in session state (so it survives a mod reload) and is copied to the plugin store under the session id (so it survives a restart).

**Check, test, run**

```bash
claude plugin validate ./bookmarks            # manifest + hooks, the way Claude Code reads them
claude plugin test ./bookmarks                # the tests in tests/
claude --plugin-dir ./bookmarks               # a live session that reloads on save
tsc -p ./bookmarks                            # type-check (after Claude Code has loaded the mod once)
```

`.claude-plugin/types/` is written by Claude Code each time it loads the mod (it holds the API's type declarations for your editor). It is git-ignored.

---

## License

[WTFPL](LICENSE): Do What The Fuck You Want To Public License, version 2. Copy it, change it, ship it, do whatever you want with it.
