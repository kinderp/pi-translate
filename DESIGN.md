# pi-translate — Design dell'estensione di traduzione trasparente

> Stato: **design approvato, pronto per implementazione**.
> Tutti i meccanismi descritti sono stati verificati nel codice di pi
> (`@earendil-works/pi-coding-agent`, dist installato) e nella documentazione ufficiale.

## 1. Obiettivo

L'utente scrive i prompt in italiano (o altra lingua configurata). L'estensione:

1. **Input**: traduce IT → EN ciò che viene inviato al modello. Il modello lavora sempre in inglese (prompt, contesto, tool call).
2. **Output**: la risposta dell'agente (inglese) viene **sostituita** dalla traduzione italiana nel transcript. L'inglese NON resta visibile sotto.
3. **Originale on-demand**: l'utente può vedere l'output inglese originale in un **pannello laterale nativo** (overlay TUI), senza tmux.
4. **Trasparenza**: nessun cambiamento nel flusso di interazione. Niente domande, niente conferme. Solo una piccola scritta di stato nel footer (opzionale).

### Decisione chiave di architettura

La **sessione (file JSONL) resta in italiano** per i messaggi visibili all'utente, mentre **il contesto inviato al modello è sempre inglese**. Questo si ottiene con due proprietà di pi verificate nel sorgente:

- i messaggi persistono l'intero oggetto (campi extra sopravvivono nel JSONL) → salviamo la traduzione inglese **dentro il messaggio stesso** come campo custom;
- l'evento `context` permette di modificare (su copia) i messaggi prima di ogni chiamata LLM → rimpiazziamo l'italiano con l'inglese **senza costo di rete**, usando le traduzioni già salvate.

Risultato: zero chiamate di traduzione nel percorso critico del contesto; ogni testo viene tradotto **una sola volta**.

## 2. Flussi

### 2.1 Input utente (IT → EN)

```
utente scrive "sistema il bug nel login"
   │
   ▼
evento `input`  (hook awaitato, prima di skill/template expansion)
   │  • skip se inizia con "/" (comandi/template) o "!" / "!!" (bash)
   │  • skip se source === "extension" (messaggi di altre estensioni)
   │  • protegge i token @path/file.ts con placeholder
   │  • traduce → "fix the bug in the login" (1 sola chiamata di rete)
   │  • salva in mappa pending: hash(testo italiano) → inglese
   │  • ritorna { action: "continue" }  ← il testo visibile resta ITALIANO
   ▼
pi crea il messaggio utente (italiano) e lo mostra nel transcript
   ▼
evento `message_end` (role: "user")  ← hook awaitato prima della persistenza
   │  • attacca al messaggio:  message.piTranslate = { en: "fix the bug...", lang: "it" }
   │  • ritorna { message } (sostituzione, stesso role)
   ▼
messaggio persistito in JSONL con traduzione embedded → sopravvive a /resume, /fork, /tree
```

Se un messaggio utente arriva senza passare da `input` (RPC, `sendUserMessage` di altre estensioni, sessioni vecchie), l'evento `context` lo traduce al volo con cache in memoria (fallback, comunque corretto).

### 2.2 Contesto verso il modello (sempre EN, zero rete)

```
evento `context`  (prima di OGNI chiamata LLM, su structuredClone dei messaggi)
   │  per ogni messaggio:
   │  • user      con piTranslate.en        → content ← inglese salvato      (no rete)
   │  • user      senza traduzione          → traduci ora + cache            (fallback)
   │  • assistant con piTranslate.original  → text blocks ← inglese salvato  (no rete)
   │  • toolResult, thinking, toolCall      → invariati (già inglese)
   ▼
il modello vede una conversazione 100% inglese
```

### 2.3 Output assistente (EN → IT, con sostituzione)

```
streaming live: l'utente vede l'inglese scorrere (inevitabile, vedi §7 "flip")
   ▼
evento `message_end` (role: "assistant")
   │  • skip se stopReason === "error"
   │  • salva i text block inglesi:  piTranslate.original = [...]
   │  • protegge code fence / inline code / path con placeholder
   │  • traduce EN → IT (1 chiamata di rete, non blocca il turno se ci sono tool call)
   │  • ritorna { message } con content in italiano
   ▼
VERIFICATO nel sorgente (agent-session.js _handleAgentEvent):
la sostituzione avviene PRIMA della persistenza e PRIMA della notifica al TUI
   → il transcript mostra SOLO l'italiano
   → il JSONL contiene italiano + originale inglese embedded
```

Cosa NON viene tradotto (per scelta): thinking block (il "lavoro sporco" resta inglese, tanto è collassabile con Ctrl+T), tool call e tool result, output di bash. Solo la prosa dell'assistente.

### 2.4 Compaction

`session_before_compact`: aggiungiamo `customInstructions: "Write the summary in English."` così anche i riassunti restano in inglese nel contesto (la sessione li mostra con rendering proprio, impatto minimo).

## 3. Visualizzazione dell'originale inglese

**Niente tmux: pi ha gli overlay nativi** (`ctx.ui.custom(..., { overlay: true, overlayOptions })`, verificato in docs/tui.md e examples/extensions/overlay-test.ts).

### Pannello laterale (primario)

- **Trigger**: shortcut `ctrl+shift+e` (libero, configurabile) oppure comando `/translate-original`.
- **Rendering**: overlay ancorato a destra: `{ anchor: "right-center", width: "55%", maxHeight: "90%", visible: (w) => w >= 100 }`.
- **Contenuto**: componente `Markdown` (da `@earendil-works/pi-tui` + `getMarkdownTheme()`) con l'originale inglese dell'ultimo messaggio assistente che ha `piTranslate.original`, trovato scorrendo `ctx.sessionManager.getBranch()` all'indietro.
- **Interazione**: ↑/↓/PgUp/PgDn per scrollare, `Esc` per chiudere. Componente creato fresco a ogni apertura (gli overlay vengono disposed alla chiusura).

### Mirror su file (alternativa tmux, opzionale)

Config `mirrorFile` (es. `/tmp/pi-translate-original.md`): ogni originale inglese viene anche appeso a quel file. Chi vuole il tmux split: `/translate-mirror` → se `$TMUX` è settato, l'estensione esegue `tmux split-window -h "less +F /tmp/pi-translate-original.md"` via `pi.exec`. Due righe di codice, nessuna magia.

## 4. Backend di traduzione (pluggabili)

Interfaccia unica:

```typescript
interface Translator {
  name: string;
  translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string>;
}
```

| Backend | Chiave | Velocità | Qualità | Note |
|---|---|---|---|---|
| **google** (default) | nessuna | ~150-400 ms | buona | endpoint gratuito `translate.googleapis.com/translate_a/single?client=gtx` — **testato e funzionante**. Con `sl=auto` ritorna anche la lingua rilevata (`resp[2]`) → skip gratis se il testo è già inglese. Chunking a ~4k caratteri su confini di paragrafo. |
| **llm** | quella del provider | ~0.5-1.5 s | ottima (contesto-aware, rispetta i placeholder meglio) | usa un modello **diverso da quello di sessione** via `ctx.modelRegistry.find(provider, id)` + `ctx.modelRegistry.getApiKeyAndHeaders(model)` + `complete()` da `@earendil-works/pi-ai/compat` (pattern verificato in examples/extensions/qna.ts). Consigliati: `google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`, o modello locale **llama.cpp** (gratis, offline). Prompt: "Translate from X to English. Output ONLY the translation. Text between ⟦n⟧ placeholders is code/paths: keep placeholders unchanged." |
| **mymemory** | nessuna (opz. email) | ~300-600 ms | media | `api.mymemory.translated.net`, gratis con limiti giornalieri. |
| **libretranslate** | istanza propria o pubblica | varia | media | self-hostable, per chi vuole controllo totale. |

**Fail-open**: se la traduzione fallisce (rete, rate limit), si usa il testo originale e si mostra una `notify` warning una tantum. L'agente non si blocca MAI per colpa della traduzione.

## 5. Protezione di codice e path (`protect.ts`)

Prima di tradurre, sostituiamo con placeholder `⟦0⟧`, `⟦1⟧`, … e ripristiniamo dopo:

- fenced code block ```` ``` ```` (output assistente)
- inline code `` ` `` (output assistente)
- `@path/al/file.ts` (input utente)
- URL e percorsi assoluti tipo `/usr/local/bin`

Google Translate rispetta quasi sempre token non-latin come `⟦n⟧`; il backend LLM li rispetta se istruito nel prompt.

## 6. Configurazione

File `~/.pi/agent/translate.json` (creato al primo avvio con default sensati — zero setup obbligatorio):

```json
{
  "enabled": true,
  "sourceLang": "it",
  "backend": "google",
  "outputMode": "translate",
  "protectCode": true,
  "showFooterStatus": true,
  "originalShortcut": "ctrl+shift+e",
  "mirrorFile": "",
  "llm": { "provider": "google", "model": "gemini-2.5-flash" }
}
```

- `outputMode: "translate"` → pipeline completa con originale inglese nel pannello (default, come da requisiti).
- `outputMode: "native"` → **senza traduzione in uscita**: `before_agent_start` aggiunge al system prompt "Answer the user in Italian" (stream direttamente italiano, zero latenza, niente "flip", ma niente originale inglese). Opzione per chi privilegia la discrezione assoluta.

Comandi registrati:

| Comando | Azione |
|---|---|
| `/translate` | toggle on/off (stato mostrato nel footer: `⇄ it`) |
| `/translate-config` | pannello SettingsList per cambiare backend/lingua/modello senza toccare il JSON |
| `/translate-original` | apre il pannello con l'originale inglese |
| `/translate-mirror` | apre tmux split sul mirror file (se in tmux) |

## 7. Latenza e discrezione (onestà tecnica)

| Momento | Costo | Visibilità |
|---|---|---|
| invio prompt | 1 round-trip traduzione (~0.2-0.5 s google) | nessuna: il loader "working" parte come sempre, l'attesa si confonde col thinking del modello |
| ogni chiamata LLM successiva | **0 rete** (swap da traduzioni salvate) | nessuna |
| fine risposta assistente | 1 round-trip, poi il testo **cambia da inglese a italiano** ("flip") | durante lo streaming si vede inglese: è l'unico compromesso non eliminabile in `outputMode: "translate"` — i hook di pi non permettono di alterare il render dello stream in corso, solo il messaggio finale (verificato: `message_update` non supporta sostituzione, `message_end` sì). Chi vuole zero flip usa `outputMode: "native"`. |
| footer | — | status discreto `⇄ it` + "Traduzione…" durante il flip |

## 8. Edge cases gestiti

- `/comandi`, `/template`, `!cmd`, `!!cmd` → mai tradotti (bypass nell'handler `input`).
- Messaggi steer/follow-up durante streaming → stessa pipeline (`streamingBehavior` ignorato ai fini della traduzione).
- Sessioni riprese/forkate → traduzioni embedded nel JSONL, funziona tutto senza cache in memoria.
- Messaggio utente senza passaggio da `input` (RPC, altre estensioni) → tradotto lazy in `context` con cache.
- `stopReason: "error"` → niente traduzione output.
- Testo già in inglese → skip (google `sl=auto` rileva; LLM istruito a rispondere `SAME`).
- Modalità `print`/`json`: pipeline attiva, UI disattivata (guard `ctx.hasUI` / `ctx.mode === "tui"`).

## 9. Struttura del codice

```
translate/
├── index.ts      # factory, event handlers (input/message_end/context/compaction), comandi, shortcut
├── backends.ts   # Translator + google / llm / mymemory / libretranslate
├── protect.ts    # placeholder per code fence, inline code, @path, URL
├── config.ts     # load/save translate.json, default
└── panel.ts      # overlay component per l'originale inglese
```

Installazione: symlink o copia in `~/.pi/agent/extensions/translate/` (auto-discovery + `/reload`).
Sviluppo: `pi -e /lab/azzuici/translate/index.ts`.

Pubblicabile poi come pi package (`pi install git:...`) aggiungendo `package.json` con chiave `pi.extensions`.

## 10. Riferimenti verificati (per l'implementatore)

- Eventi: `docs/extensions.md` — `input`, `message_end` (sostituzione consentita, stesso role), `context` (structuredClone, ritorna `{messages}`), `before_agent_start`, `session_before_compact`.
- Ordinamento sostituzione→TUI→persistenza: `dist/core/agent-session.js` (`_emitExtensionEvent` awaitato prima di `_emit` e di `appendMessage`); persistenza oggetto grezzo: `dist/core/session-manager.js:766`.
- Chiamata LLM custom: `examples/extensions/qna.ts` (`complete` da `@earendil-works/pi-ai/compat`, `getApiKeyAndHeaders`).
- Overlay: `docs/tui.md` sezione Overlays + `examples/extensions/overlay-test.ts`.
- Componenti: `Markdown`, `getMarkdownTheme`, `SelectList`, `SettingsList`, `BorderedLoader`.
- UI: `ctx.ui.setStatus`, `setWorkingMessage`, `notify`, `custom`.
- Shortcut libere: `ctrl+shift+e` (verificato contro docs/keybindings.md).
