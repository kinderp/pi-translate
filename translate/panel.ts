import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  matchesKey,
  type Component,
  type Theme,
} from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { PiTranslateMeta } from "./types.ts";

export type OriginalPanelState = {
  message: AssistantMessage & { piTranslate: PiTranslateMeta };
  onClose: () => void;
};

export class OriginalPanel implements Component {
  private theme: Theme;
  private state: OriginalPanelState;
  private cachedLines: string[] = [];
  private scroll = 0;
  private lastWidth = 80;

  constructor(theme: Theme, state: OriginalPanelState) {
    this.theme = theme;
    this.state = state;
  }

  render(width: number): string[] {
    this.lastWidth = width;
    const height = process.stdout.rows || 24;
    const innerW = Math.max(4, width - 4);
    const innerH = Math.max(4, height - 5);

    const original = this.state.message.piTranslate.original;
    const modelLang = this.state.message.piTranslate.sourceLang ?? "en";
    const source = original
      ? this.originalToMarkdown(original)
      : `_Original ${modelLang.toUpperCase()} not available_`;

    const md = new Markdown(source, 1, 1, getMarkdownTheme());
    this.cachedLines = md.render(innerW);

    const visible = this.cachedLines.slice(this.scroll, this.scroll + innerH);
    while (visible.length < innerH) visible.push("");

    const title = ` Original ${modelLang.toUpperCase()} `;
    const help = " ↑/↓ PgUp/PgDn scroll • Esc/q close ";

    const topBorder = "┌" + title.padEnd(innerW - 1, "─") + "┐";
    const botBorder = "└" + help.slice(0, innerW - 1).padEnd(innerW - 1, "─") + "┘";

    const lines: string[] = [topBorder];
    for (const row of visible) {
      const padded = row.padEnd(innerW, " ");
      lines.push("│ " + padded.slice(0, innerW) + " │");
    }
    lines.push(botBorder);
    return lines;
  }

  handleInput(data: string): boolean {
    const h = Math.max(1, (process.stdout.rows || 24) - 5);
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.state.onClose();
      return true;
    }
    if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
    else if (matchesKey(data, "down")) this.scroll = Math.max(0, Math.min(this.cachedLines.length - h, this.scroll + 1));
    else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - h);
    else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, Math.min(this.cachedLines.length - h, this.scroll + h));
    else if (matchesKey(data, "home")) this.scroll = 0;
    else if (matchesKey(data, "end")) this.scroll = Math.max(0, this.cachedLines.length - h);
    else return false;
    return true;
  }

  private originalToMarkdown(original: AssistantMessage["content"]): string {
    return original
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n\n");
  }
}

export function openOriginalPanel(
  ctx: ExtensionContext,
  message: AssistantMessage & { piTranslate: PiTranslateMeta },
): void {
  if (!ctx.hasUI) return;
  void ctx.ui.custom<undefined>(
    (_tui, theme, _keybindings, done) =>
      new OriginalPanel(theme, {
        message,
        onClose: () => done(undefined),
      }),
    {
      overlay: true,
      overlayOptions: {
        anchor: "right-center",
        width: "55%",
        minWidth: 40,
      },
    },
  );
}
