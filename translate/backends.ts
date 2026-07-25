import { complete } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { protect } from "./protect.ts";
import type { Config } from "./config.ts";

export interface Translator {
  name: string;
  translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string>;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && (err.message.includes("fetch") || err.message.includes("network") || err.name === "AbortError");
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n\n", end);
      if (boundary > start) end = boundary;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks;
}

function createGoogleTranslator(): Translator {
  return {
    name: "google",
    async translate(text, from, to, signal) {
      const chunks = chunkText(text, 4000);
      const results: string[] = [];
      for (const chunk of chunks) {
        const url = new URL("https://translate.googleapis.com/translate_a/single");
        url.searchParams.set("client", "gtx");
        url.searchParams.set("sl", from);
        url.searchParams.set("tl", to);
        url.searchParams.set("dt", "t");
        url.searchParams.set("q", chunk);

        let retries = 1;
        let lastErr: Error | undefined;
        while (retries >= 0) {
          try {
            const response = await fetch(url.toString(), { signal });
            if (!response.ok) {
              throw new Error(`Google Translate HTTP ${response.status}`);
            }
            const data = (await response.json()) as unknown;
            const detected = Array.isArray(data) ? data[2] : undefined;
            if (detected === to) {
              results.push(chunk);
            } else {
              const sentences = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
              const translated = sentences
                .map((s: unknown) => Array.isArray(s) && typeof s[0] === "string" ? s[0] : "")
                .join("");
              results.push(translated);
            }
            break;
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (lastErr.name === "AbortError") throw lastErr;
            retries--;
            if (retries < 0) break;
            await new Promise((r) => setTimeout(r, 300));
          }
        }
        if (lastErr) throw lastErr;
      }
      return results.join("");
    },
  };
}

function createMyMemoryTranslator(): Translator {
  return {
    name: "mymemory",
    async translate(text, from, to, signal) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text);
      url.searchParams.set("langpair", `${from}|${to}`);
      const response = await fetch(url.toString(), { signal });
      if (!response.ok) {
        throw new Error(`MyMemory HTTP ${response.status}`);
      }
      const data = await response.json() as { responseData?: { translatedText?: string } };
      return data.responseData?.translatedText ?? text;
    },
  };
}

function createLibreTranslateTranslator(baseUrl: string): Translator {
  return {
    name: "libretranslate",
    async translate(text, from, to, signal) {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: from, target: to, format: "text" }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`LibreTranslate HTTP ${response.status}`);
      }
      const data = await response.json() as { translatedText?: string };
      return data.translatedText ?? text;
    },
  };
}

function createLlmTranslator(cfg: Config, registry: ModelRegistry): Translator {
  return {
    name: "llm",
    async translate(text, from, to, signal) {
      const model = registry.find(cfg.llm.provider, cfg.llm.model);
      if (!model) {
        throw new Error(`LLM translator model not found: ${cfg.llm.provider}/${cfg.llm.model}`);
      }
      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        throw new Error(auth.ok ? `No API key for ${cfg.llm.provider}` : auth.error);
      }

      const { text: protectedText, restore } = protect(text);

      const prompt = `Translate the text below from ${from} to ${to}.
Rules:
- Output ONLY the translation, no explanations.
- Keep placeholders like ⟦0⟧, ⟦1⟧ unchanged (they are code/paths).
- If the text is already in ${to}, output it unchanged.

Text:
${protectedText}`;

      const response = await complete(
        model,
        {
          systemPrompt: "You are a precise translator.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          signal,
        },
      );

      const translated = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return restore(translated);
    },
  };
}

export function createTranslator(cfg: Config, registry?: ModelRegistry): Translator {
  switch (cfg.backend) {
    case "google":
      return createGoogleTranslator();
    case "mymemory":
      return createMyMemoryTranslator();
    case "libretranslate":
      return createLibreTranslateTranslator(process.env.LIBRETRANSLATE_URL ?? "http://localhost:5000");
    case "llm":
      if (!registry) {
        throw new Error("LLM backend requires a ModelRegistry");
      }
      return createLlmTranslator(cfg, registry);
    default:
      return createGoogleTranslator();
  }
}

/**
 * Translate with optional code/path protection. Fail-open: returns original on error.
 */
export async function safeTranslate(
  translator: Translator,
  text: string,
  from: string,
  to: string,
  options: { protectCode?: boolean; signal?: AbortSignal } = {},
): Promise<{ text: string; skipped: boolean; error?: string }> {
  if (!text.trim()) {
    return { text, skipped: true };
  }
  try {
    const { text: protectedText, restore } = options.protectCode ? protect(text) : { text, restore: (t: string) => t };
    const translated = await translator.translate(protectedText, from, to, options.signal);
    return { text: restore(translated), skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text, skipped: false, error: message };
  }
}
