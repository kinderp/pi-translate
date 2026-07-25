import type {
  AgentMessage,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { writeFile } from "node:fs/promises";
import { createTranslator, safeTranslate } from "./backends.ts";
import { loadConfig, saveConfig, type Config } from "./config.ts";
import { openOriginalPanel } from "./panel.ts";
import type { PiTranslateMeta } from "./types.ts";

const STATUS_PREFIX = "⇄";

function updateStatus(cfg: Config, ctx: ExtensionContext): void {
  if (!cfg.showFooterStatus || !ctx.hasUI) {
    ctx.ui.setStatus("translate", undefined);
    return;
  }
  const label = cfg.enabled
    ? `${STATUS_PREFIX} ${cfg.sourceLang}`
    : `${STATUS_PREFIX} off`;
  ctx.ui.setStatus("translate", ctx.ui.theme.fg("accent", label));
}

function isUserMessage(msg: AgentMessage): msg is UserMessage {
  return msg.role === "user";
}

function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
  return msg.role === "assistant";
}

function extractText(content: string | (TextContent | { type: "image" })[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function translateAssistantContent(
  content: AssistantMessage["content"],
  translator: ReturnType<typeof createTranslator>,
  targetLang: string,
  protectCode: boolean,
  signal: AbortSignal | undefined,
): Promise<AssistantMessage["content"]> {
  const results: AssistantMessage["content"] = [];
  for (const c of content) {
    if (c.type === "text") {
      const result = await safeTranslate(
        translator,
        c.text,
        "en",
        targetLang,
        { protectCode, signal },
      );
      results.push({ type: "text", text: result.text });
    } else {
      results.push(c);
    }
  }
  return results;
}

function originalToText(original: AssistantMessage["content"]): string {
  return original
    .map((c) => (c.type === "text" ? c.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function setTranslatedContent(
  msg: UserMessage,
  enText: string,
): void {
  if (typeof msg.content === "string") {
    (msg as UserMessage & { piTranslate: PiTranslateMeta }).piTranslate.en = enText;
    return;
  }

  // Array content: preserve non-text blocks (e.g. images), replace the first
  // text block with the full translation and drop subsequent text blocks.
  const translatedContent: (TextContent | { type: "image" })[] = [];
  let textReplaced = false;
  for (const c of msg.content) {
    if (c.type === "text") {
      if (!textReplaced) {
        translatedContent.push({ type: "text", text: enText });
        textReplaced = true;
      }
    } else {
      translatedContent.push(c);
    }
  }
  if (!textReplaced) {
    translatedContent.push({ type: "text", text: enText });
  }
  (msg as UserMessage & { piTranslate: PiTranslateMeta }).piTranslate.en = translatedContent;
}

export default function (pi: ExtensionAPI): void {
  let cfg: Config = loadConfig();
  const pending = new Map<string, string>();
  const contextCache = new Map<string, string>();
  let lastErrorNotified = false;
  let lastAssistantOriginal: (AssistantMessage & { piTranslate: PiTranslateMeta }) | undefined;

  pi.on("session_start", async (_event, ctx) => {
    cfg = loadConfig();
    pending.clear();
    contextCache.clear();
    lastErrorNotified = false;
    lastAssistantOriginal = undefined;
    updateStatus(cfg, ctx);
  });

  pi.registerCommand("translate", {
    description: "Toggle translation on/off",
    handler: async (_args, ctx) => {
      cfg.enabled = !cfg.enabled;
      saveConfig(cfg);
      updateStatus(cfg, ctx);
      ctx.ui.notify(
        `Translation ${cfg.enabled ? "enabled" : "disabled"}`,
        "info",
      );
    },
  });

  pi.registerCommand("translate-original", {
    description: "Show the original English response in a panel",
    handler: async (_args, ctx) => {
      if (!lastAssistantOriginal) {
        ctx.ui.notify("No original English response available yet", "warning");
        return;
      }
      openOriginalPanel(ctx, lastAssistantOriginal);
    },
  });

  pi.registerCommand("translate-mirror", {
    description: "Write the original English response to a file",
    handler: async (args, ctx) => {
      const path = args.trim();
      if (!path) {
        ctx.ui.notify("Usage: /translate-mirror <file-path>", "warning");
        return;
      }
      if (!lastAssistantOriginal) {
        ctx.ui.notify("No original English response available yet", "warning");
        return;
      }
      const text = originalToText(lastAssistantOriginal.piTranslate.original ?? []);
      try {
        await writeFile(path, text, "utf8");
        ctx.ui.notify(`Original English written to ${path}`, "info");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Failed to write mirror: ${message}`, "error");
      }
    },
  });

  pi.registerShortcut("ctrl+shift+e", async (ctx) => {
    if (!lastAssistantOriginal) {
      ctx.ui.notify("No original English response available yet", "warning");
      return;
    }
    openOriginalPanel(ctx, lastAssistantOriginal);
  });

  pi.on("input", async (event: InputEvent, ctx) => {
    if (!cfg.enabled) return { action: "continue" };
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();
    if (!text) return { action: "continue" };

    // Skip slash commands/templates and bash prefixes
    if (text.startsWith("/") || text.startsWith("!")) {
      return { action: "continue" };
    }

    const translator = createTranslator(cfg, ctx.modelRegistry);
    const result = await safeTranslate(
      translator,
      text,
      cfg.sourceLang,
      "en",
      { protectCode: cfg.protectCode, signal: ctx.signal },
    );

    if (result.error) {
      if (!lastErrorNotified) {
        lastErrorNotified = true;
        ctx.ui.notify(`Translation failed: ${result.error}`, "warning");
      }
    } else {
      lastErrorNotified = false;
    }

    pending.set(text, result.text);
    return { action: "continue" };
  });

  pi.on("message_end", async (event: MessageEndEvent, ctx) => {
    const msg = event.message;
    if (!cfg.enabled) return;

    if (isUserMessage(msg)) {
      const originalText = extractText(msg.content);
      const enText = pending.get(originalText) ?? contextCache.get(originalText);
      if (!enText) return;

      const meta: PiTranslateMeta = {
        sourceLang: cfg.sourceLang,
        targetLang: "en",
        backend: cfg.backend,
      };
      (msg as UserMessage & { piTranslate: PiTranslateMeta }).piTranslate = meta;
      setTranslatedContent(msg, enText);
      pending.delete(originalText);
      return { message: msg };
    }

    if (isAssistantMessage(msg)) {
      if (msg.stopReason === "error" || cfg.outputMode === "native") {
        return;
      }

      const hasText = msg.content.some((c) => c.type === "text" && c.text.trim());
      if (!hasText) {
        return;
      }

      const translator = createTranslator(cfg, ctx.modelRegistry);
      const originalContent = msg.content;

      ctx.ui.setWorkingMessage("Translating response…");
      try {
        const translatedContent = await translateAssistantContent(
          originalContent,
          translator,
          cfg.sourceLang,
          cfg.protectCode,
          ctx.signal,
        );

        const meta: PiTranslateMeta = {
          sourceLang: "en",
          targetLang: cfg.sourceLang,
          backend: cfg.backend,
          original: originalContent,
        };
        (msg as AssistantMessage & { piTranslate: PiTranslateMeta }).piTranslate = meta;
        msg.content = translatedContent;
        lastAssistantOriginal = msg as AssistantMessage & { piTranslate: PiTranslateMeta };
        return { message: msg };
      } finally {
        ctx.ui.setWorkingMessage();
      }
    }

    return;
  });

  pi.on("context", async (event, ctx) => {
    if (!cfg.enabled) return;

    const messages = event.messages;
    const translator = createTranslator(cfg, ctx.modelRegistry);

    for (const msg of messages) {
      if (isAssistantMessage(msg)) {
        const original = (msg as AssistantMessage & { piTranslate?: PiTranslateMeta }).piTranslate?.original;
        if (original !== undefined) {
          msg.content = original;
        }
        continue;
      }

      if (!isUserMessage(msg)) continue;

      const translated = (msg as UserMessage & { piTranslate?: PiTranslateMeta }).piTranslate?.en;
      if (translated !== undefined) {
        msg.content = translated;
        continue;
      }

      const originalText = extractText(msg.content);
      const cached = contextCache.get(originalText);
      if (cached) {
        msg.content = cached;
        continue;
      }

      const result = await safeTranslate(
        translator,
        originalText,
        cfg.sourceLang,
        "en",
        { protectCode: cfg.protectCode },
      );
      contextCache.set(originalText, result.text);
      if (typeof msg.content === "string") {
        msg.content = result.text;
      } else {
        const fallbackContent: (TextContent | { type: "image" })[] = [
          { type: "text", text: result.text },
        ];
        for (const c of msg.content) {
          if (c.type !== "text") fallbackContent.push(c);
        }
        msg.content = fallbackContent;
      }
    }

    return { messages };
  });
}
