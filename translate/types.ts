import type { AssistantMessage, TextContent, UserMessage } from "@earendil-works/pi-ai";

export interface PiTranslateMeta {
  /** Language the source text was written in */
  sourceLang: string;
  /** Target language for the model (always English in this extension) */
  targetLang: string;
  /** Backend used for the translation */
  backend: string;
  /**
   * English translation stored on user messages.
   * Shape mirrors the original user message content (string or content blocks).
   */
  en?: string | TextContent[];
  /**
   * Original English assistant message content, stored before translation to Italian.
   */
  original?: AssistantMessage["content"];
}

export type TranslatedUserMessage = UserMessage & { piTranslate: PiTranslateMeta };
export type TranslatedAssistantMessage = AssistantMessage & { piTranslate: PiTranslateMeta };

export function hasPiTranslate<T extends { piTranslate?: PiTranslateMeta }>(
  msg: T,
): msg is T & { piTranslate: PiTranslateMeta } {
  return msg.piTranslate !== undefined;
}
