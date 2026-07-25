export interface ProtectedText {
  text: string;
  restore(translated: string): string;
}

const MARKER_PREFIX = "⟦";
const MARKER_SUFFIX = "⟧";

function makePlaceholder(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Protects code blocks, inline code, @file references, URLs and absolute paths
 * from being translated. Returns a plain text with placeholders and a restore
 * function to re-inject the originals after translation.
 */
export function protect(text: string): ProtectedText {
  const originals: string[] = [];
  let placeholderIndex = 0;

  const push = (original: string): string => {
    const idx = placeholderIndex++;
    originals[idx] = original;
    return makePlaceholder(idx);
  };

  // Fenced code blocks (```...```)
  let protectedText = text.replace(
    /```[\s\S]*?```/g,
    (match) => push(match),
  );

  // Inline code (`...`)
  protectedText = protectedText.replace(
    /`[^`\n]+`/g,
    (match) => push(match),
  );

  // @file references
  protectedText = protectedText.replace(
    /@[^\s\n]+/g,
    (match) => push(match),
  );

  // URLs
  protectedText = protectedText.replace(
    /https?:\/\/[^\s\n]+/g,
    (match) => push(match),
  );

  // Absolute paths
  protectedText = protectedText.replace(
    /(?:\/[\w.-]+)+\/?/g,
    (match) => push(match),
  );

  return {
    text: protectedText,
    restore(translated: string): string {
      let restored = translated;
      for (let i = originals.length - 1; i >= 0; i--) {
        const placeholder = makePlaceholder(i);
        const regex = new RegExp(escapeRegExp(placeholder), "g");
        restored = restored.replace(regex, originals[i]!);
      }
      return restored;
    },
  };
}
