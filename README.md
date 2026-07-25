# pi-translate

Estensione per [`pi`](https://github.com/earendil-works/pi-coding-agent) che traduce automaticamente i prompt dall'italiano (o da un'altra lingua) all'inglese prima di inviarli al modello, e traduce la risposta inglese del modello in italiano nella trascrizione. Il testo inglese originale è sempre consultabile su richiesta tramite un pannello nativo.

## Funzionalità

- **Prompt in italiano, modello in inglese**: scrivi in italiano, `pi-translate` traduce il contesto prima di ogni chiamata LLM.
- **Risposte in italiano nella chat**: la risposta del modello viene tradotta in italiano al termine della generazione.
- **Originale inglese sempre disponibile**: premendo `Ctrl+Shift+E` si apre un pannello overlay nativo con il testo originale dell'ultima risposta.
- **Backend pluggable**: Google Translate (default, gratuito), MyMemory, LibreTranslate oppure un LLM separato.
- **Protezione del codice**: blocchi di codice, `inline code`, percorsi `@file`, URL e path assoluti vengono sostituiti da placeholder durante la traduzione e ripristinati invariati.

## Installazione

Copia o clona questa cartella dove preferisci e avvia `pi` puntando all'estensione:

```bash
pi -e /percorso/a/translate/index.ts
```

Per usarla permanentemente aggiungila alla configurazione di `pi` (ad esempio in `~/.pi/agent/extensions`).

## Comandi

| Comando | Descrizione |
|---------|-------------|
| `/translate` | Abilita/disabilita la traduzione. |
| `/translate-backend <backend>` | Cambia backend: `google`, `mymemory`, `libretranslate`, `llm`. |
| `/translate-lang <codice>` | Cambia la lingua sorgente (es. `it`, `es`, `fr`). |
| `/translate-protect` | Attiva/disattiva la protezione di codice/path. |
| `/translate-mode` | Alterna tra `translate` (traduci output) e `native` (il modello risponde direttamente nella lingua sorgente). |
| `/translate-status` | Mostra le impostazioni correnti. |
| `/translate-original` | Apre il pannello con l'ultima risposta inglese. |
| `/translate-mirror <percorso>` | Scrive l'ultima risposta inglese su file. |

## Shortcut

- `Ctrl+Shift+E` — apri il pannello con il testo originale inglese dell'ultima risposta.

## Configurazione

La configurazione viene salvata in `~/.pi/agent/translate.json`:

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
  "llm": {
    "provider": "google",
    "model": "gemini-2.5-flash"
  }
}
```

## Backend supportati

- `google` — endpoint gratuito `client=gtx` di Google Translate, rilevamento automatico della lingua.
- `mymemory` — API gratuita di MyMemory (`api.mymemory.translated.net`).
- `libretranslate` — istanza self-hosted o pubblica; URL configurabile via variabile d'ambiente `LIBRETRANSLATE_URL`.
- `llm` — qualsiasi modello registrato in `pi` tramite `modelRegistry`.

## Note e limitazioni

- In modalità `outputMode: "translate"` il testo in inglese è visibile durante lo streaming e viene sostituito dall'italiano solo al termine del messaggio (`message_end`). Questo è un limite di `pi`.
- Per evitare la sostituzione visibile usare `outputMode: "native"`: il modello riceve il solito contesto inglese ma risponde in italiano (richiede che il modello segua l'istruzione di sistema).
- I comandi `/`, i prefissi `!`/`!!` e i messaggi inviati da altre estensioni non vengono tradotti.

## Licenza

MIT
