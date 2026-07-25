# Piano di implementazione — pi-translate

> **Stato:** implementazione completata. Tutti gli issue figli (#1–#7) sono stati risolti e mergiati in `main`. Questo documento descrive il piano originale; per l'uso dell'estensione vedere `README.md`.

> Da eseguire con **kimi 2.7** dopo aver letto `DESIGN.md`.
> Ogni step è indipendentemente testabile. Tempi stimati con agente che scrive + umano che testa.

## Issue e PR completate

- [#1](https://github.com/kinderp/pi-translate/issues/1) scheletro/config → PR [#9](https://github.com/kinderp/pi-translate/pull/9)
- [#2](https://github.com/kinderp/pi-translate/issues/2) backend Google + protezione → PR [#10](https://github.com/kinderp/pi-translate/pull/10)
- [#3](https://github.com/kinderp/pi-translate/issues/3) pipeline input IT→EN → PR [#11](https://github.com/kinderp/pi-translate/pull/11)
- [#4](https://github.com/kinderp/pi-translate/issues/4) pipeline output EN→IT → PR [#12](https://github.com/kinderp/pi-translate/pull/12)
- [#5](https://github.com/kinderp/pi-translate/issues/5) pannello originale + mirror → PR [#13](https://github.com/kinderp/pi-translate/pull/13)
- [#6](https://github.com/kinderp/pi-translate/issues/6) backend extra e comandi di configurazione → PR [#14](https://github.com/kinderp/pi-translate/pull/14)
- [#7](https://github.com/kinderp/pi-translate/issues/7) rifinitura e documentazione → PR in corso

## Setup (2 min)

```bash
mkdir -p /lab/azzuici/translate
cd /lab/azzuici
# test rapido: pi -e ./translate/index.ts
# installazione definitiva (dopo): ln -s /lab/azzuici/translate ~/.pi/agent/extensions/translate
```

## Step 1 — Scheletro + config (~20 min)

- `config.ts`: load/save `~/.pi/agent/translate.json` con default da DESIGN §6; crea il file se manca.
- `index.ts`: factory di default, `session_start` che carica config, footer status `⇄ it` via `ctx.ui.setStatus("translate", ...)` (solo se `ctx.hasUI`).
- Comando `/translate` per toggle enabled (persiste su JSON) + notify.
- Test: `pi -e ./translate/index.ts` → footer visibile, toggle funziona, file creato.

## Step 2 — Backend google + protect (~40 min)

- `backends.ts`: interfaccia `Translator`; implementazione `google`:
  - GET `https://translate.googleapis.com/translate_a/single?client=gtx&sl=<from>&tl=<to>&dt=t&q=<encodeURIComponent(text)>`
  - risposta: array annidato → testo = concat di `resp[0][i][0]`; lingua rilevata = `resp[2]`;
  - se lingua rilevata === target → ritorna input invariato (skip gratis);
  - chunking a 4000 char su doppi `\n\n`; timeout 8 s; 1 retry; fail-open (ritorna originale).
- `protect.ts`: `protect(text) → { text, restore(t) }` con placeholder `⟦n⟧` per: fenced code, inline code, `@token`, `https?://…`, path assoluti.
- Test: `node --experimental-strip-types` o piccolo script tsx che traduce "sistema il bug nel login" con e senza protect.

## Step 3 — Pipeline input IT→EN (~45 min)

- Handler `input`: skip per `/`, `!`, `!!`, `source === "extension"`, estensione disabilitata; altrimenti proteggi + traduci + salva in `pending` (Map hash→en, cap 200) + `continue`.
- Handler `message_end` (role `user`): se esiste traduzione pending per questo testo → `message.piTranslate = { en, lang }`, ritorna `{ message }`.
- Handler `context`: per ogni user message con `piTranslate.en` → sostituisci content; senza → traduci lazy + cache. Ritorna `{ messages }`.
- Test: in TUI scrivere "elenca i file qui" → il transcript mostra italiano; verificare con `/export` o con l'handler `before_provider_request` di debug (log payload) che il modello riceva inglese.

## Step 4 — Pipeline output EN→IT (~45 min)

- Handler `message_end` (role `assistant`): skip se `errorMessage`/`stopReason === "error"`; salva `piTranslate.original` (text blocks), traduci, sostituisci content, ritorna `{ message }`.
- `context`: per assistant con `piTranslate.original` → ripristina text blocks inglesi.
- `ctx.ui.setWorkingMessage("Traduzione…")` durante il flip, reset dopo.
- Test: il transcript finale è in italiano; il file JSONL contiene italiano + `piTranslate.original` inglese; turno successivo: il modello ragiona sull'inglese (verificabile chiedendo "ripeti la tua ultima risposta in inglese" → deve matchare l'originale, non una ri-traduzione).

## Step 5 — Pannello originale + mirror (~60 min)

- `panel.ts`: componente overlay (Container + DynamicBorder + Markdown + scroll offset manuale; `handleInput` per ↑↓/PgUp/PgDn/Esc; `invalidate` che ricostruisce).
- Apertura via `/translate-original` e `pi.registerShortcut(cfg.originalShortcut)`; guard `ctx.mode === "tui"`.
- Sorgente dati: ultimo assistant message con `piTranslate.original` in `ctx.sessionManager.getBranch()`.
- Mirror: ad ogni traduzione output, append a `cfg.mirrorFile` se configurato; comando `/translate-mirror` → `pi.exec("tmux", ["split-window","-h",`less +F ${file}`])` se `process.env.TMUX`.
- Test: aprire/chiudere pannello durante e dopo lo streaming; resize terminale; tmux split.

## Step 6 — Backend llm + mymemory (~30 min)

- `llm`: `ctx.modelRegistry.find(cfg.llm.provider, cfg.llm.model)` → `getApiKeyAndHeaders` → `complete()` (import da `@earendil-works/pi-ai/compat`, pattern qna.ts); prompt con istruzioni placeholder + "if already in target language output SAME".
- `mymemory`: GET `api.mymemory.translated.net/get?q=…&langpair=it|en`.
- `/translate-config` con `SettingsList` (pattern 3 di tui.md): backend, sourceLang, outputMode, modello llm.
- Test: switch backend a runtime senza reload.

## Step 7 — Rifinitura (~45 min)

- `session_before_compact` → customInstructions "Write the summary in English."
- `outputMode: "native"` via `before_agent_start` (append system prompt).
- Gestione errori/notify una tantum; `session_shutdown` cleanup; flag `--no-translate` via `pi.registerFlag`.
- README del pacchetto + `package.json` con chiave `pi` per pubblicazione futura.
- Test di regressione completo + `/reload` + sessione ripresa (`pi -c`).

## Stime totali

| Fase | Tempo |
|---|---|
| Design (fatto, questo documento + DESIGN.md) | ~40 min |
| Step 1-4 (core pipeline) | ~2.5 h |
| Step 5-7 (UI originale, backend extra, rifinitura) | ~2.5 h |
| **Totale v1 completa** | **~4-5 h di sessione** |

Con kimi 2.7: il codice è TS semplice, niente dipendenze esterne per il backend default (solo `fetch`). Il rischio principale sono dettagli TUI (scroll overlay, focus) — mitigato copiando i pattern di `docs/tui.md`.

## Prompt da incollare a kimi 2.7

```
Leggi /lab/azzuici/DESIGN.md e /lab/azzuici/PIANO_IMPLEMENTAZIONE.md.
Implementa l'estensione pi-translate in /lab/azzuici/translate/ seguendo
gli step 1-7 in ordine. La documentazione pi è in
/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/
(extensions.md, tui.md) ed esempi in .../examples/extensions/ (qna.ts,
overlay-test.ts, input-transform.ts). Rispetta i meccanismi verificati nel
DESIGN (message_end con sostituzione, context con structuredClone, overlay
con ctx.ui.custom). Dopo ogni step fermati e fammi testare con
pi -e ./translate/index.ts
```
