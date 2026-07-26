# pi-translate

[![Release](https://img.shields.io/github/v/release/kinderp/pi-translate?color=58a6ff&label=release)](https://github.com/kinderp/pi-translate/releases)
[![License](https://img.shields.io/github/license/kinderp/pi-translate?color=3fb950)](./LICENSE)
[![pi](https://img.shields.io/badge/built%20for-pi-ff7b72)](https://github.com/earendil-works/pi-coding-agent)

> Write in Italian. Think in English (or Spanish, French…). Read in Italian.

`pi-translate` is a [pi](https://github.com/earendil-works/pi-coding-agent) extension that silently translates your prompts to a model language of your choice before the LLM sees them, then translates the model's replies back to your source language in the transcript. The original model response is always one keystroke away.

---

## ✨ What it does

- **Prompts go to the model in your chosen language** — every user message is translated before it enters the LLM context.
- **Replies appear in your source language** — assistant messages are translated back at the end of generation.
- **Original response on demand** — press `Ctrl+Shift+E` to open a native overlay panel with the untouched model output.
- **Code stays intact** — fenced blocks, inline code, `@file` references, URLs and absolute paths are protected during translation.

<p align="center">
  <img src="docs/screenshots/chat-it.svg" alt="chat in Italian" width="640">
</p>

---

## 🚀 Install

```bash
# install globally for all pi sessions
pi install npm:pi-translate

# or install only in the current project
pi install -l npm:pi-translate
```

`pi` downloads the package, adds it to your settings and loads it automatically. Default config is written to `~/.pi/agent/translate.json`.

### Try without installing

```bash
pi -e npm:pi-translate
```

### Install from source

If you prefer, you can still install directly from GitHub or a local path:

```bash
pi install git:github.com/kinderp/pi-translate@v1.0.1
# or
pi install /path/to/pi-translate
```

---

## ⌨️ Four commands to know

<p align="center">
  <img src="docs/screenshots/commands.svg" alt="commands" width="640">
</p>

| Command | What it does |
|---|---|
| `/translate` | Toggle the whole extension on or off. |
| `/translate-backend <backend>` | Switch backend: `google`, `mymemory`, `libretranslate`, `llm`. |
| `/translate-original` | Open the original model-response overlay panel. |
| `/translate-model-lang <code>` | Change the language the model reasons in (default `en`). |
| `Ctrl+Shift+E` | Same as `/translate-original`, instant. |

More: `/translate-lang`, `/translate-mode`, `/translate-protect`, `/translate-status`, `/translate-mirror <path>`.

---

## 🪟 Peek at the original

When the translated reply is on screen, hit `Ctrl+Shift+E`:

<p align="center">
  <img src="docs/screenshots/panel-en.svg" alt="original English panel" width="520">
</p>

The panel scrolls with arrow keys / Page Up / Page Down and closes with `Esc` or `q`.

---

## ⚙️ Configuration

`~/.pi/agent/translate.json`:

```json
{
  "enabled": true,
  "sourceLang": "it",
  "modelLang": "en",
  "backend": "google",
  "outputMode": "translate",
  "protectCode": true,
  "showFooterStatus": true,
  "originalShortcut": "ctrl+shift+e",
  "mirrorFile": "",
  "llm": { "provider": "google", "model": "gemini-2.5-flash" }
}
```

| Backend | Notes |
|---|---|
| `google` | Free `client=gtx` endpoint, auto-detects source language. Default. |
| `mymemory` | Free `api.mymemory.translated.net`. |
| `libretranslate` | Self-hosted or public instance via `LIBRETRANSLATE_URL`. |
| `llm` | Any model registered in `pi` via `modelRegistry`. |

---

## 🧠 Model language (`modelLang`)

By default the model reasons in **English** (`"modelLang": "en"`). You can change it with:

```bash
/translate-model-lang es   # Spanish
/translate-model-lang fr   # French
/translate-model-lang de   # German
```

### When it makes sense

- Tasks deeply rooted in another language (literary analysis, legal text, localisation review).
- Working with reference documents that are already in that language.
- Experimenting with multilingual models.

### When English is still better

- **Coding and technical tasks**: most training data, docs and tools are in English.
- **Token cost**: English is usually the most token-efficient language for LLMs.
- **Reasoning quality**: instruction following and step-by-step reasoning are generally strongest in English.

For most day-to-day work, leave `modelLang` as `en`.

---

## 🎯 Modes

- **`translate`** (default) — prompts are translated to `modelLang`; replies are translated back to `sourceLang`. Original model response viewable on demand.
- **`native`** — prompts are still translated to `modelLang`, but the model is asked to reply directly in your source language. No output flip, no original panel.

---

## 📦 Release

Latest: **[v1.0.1](https://github.com/kinderp/pi-translate/releases/tag/v1.0.1)**

## 📄 License

MIT
