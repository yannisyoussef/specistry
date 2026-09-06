import {
  SNIPPET_LIMITS,
  type Snippet,
  type ProtocolLanguage,
  type SnippetToken,
  type SnippetTokenClass,
} from "./types.js";
import { PROTOCOL_LANGUAGE_LABELS } from "./types.js";

/**
 * Token writer shared by the generators. Every generator emits classified
 * tokens (keyword, string, number, comment, …) as it goes, so the reader can
 * style generated code with the same `tok-*` classes as authored code
 * without running a highlighter at render time. The plain text is the
 * concatenation of the tokens; the two can never disagree.
 */
export class Writer {
  private readonly lines: SnippetToken[][] = [[]];

  public plain(text: string): this {
    return this.push(text);
  }

  public kw(text: string): this {
    return this.push(text, "kw");
  }

  public str(text: string): this {
    return this.push(text, "str");
  }

  public num(text: string): this {
    return this.push(text, "num");
  }

  public cmt(text: string): this {
    return this.push(text, "cmt");
  }

  public fn(text: string): this {
    return this.push(text, "fn");
  }

  public type(text: string): this {
    return this.push(text, "type");
  }

  public attr(text: string): this {
    return this.push(text, "attr");
  }

  public variable(text: string): this {
    return this.push(text, "var");
  }

  /** Ends the current line. */
  public nl(): this {
    this.lines.push([]);
    return this;
  }

  /** Appends a full line and ends it. */
  public line(text = ""): this {
    if (text.length > 0) this.push(text);
    return this.nl();
  }

  public finish(language: ProtocolLanguage): Snippet {
    // Drop the trailing empty line created by the final `nl()`.
    const lines =
      this.lines.at(-1)?.length === 0 ? this.lines.slice(0, -1) : this.lines;
    const bounded = lines.slice(0, SNIPPET_LIMITS.maxCodeLines);
    let code = bounded
      .map((line) => line.map((token) => token.text).join(""))
      .join("\n");
    let tokenLines = bounded.map((line) => mergeTokens(line));
    if (code.length > SNIPPET_LIMITS.maxCodeCharacters) {
      code = code.slice(0, SNIPPET_LIMITS.maxCodeCharacters);
      tokenLines = code
        .split("\n")
        .map((text) => (text.length === 0 ? [] : [{ text }]));
    }
    return {
      code,
      label: PROTOCOL_LANGUAGE_LABELS[language],
      language,
      lines: tokenLines,
    };
  }

  private push(text: string, cls?: SnippetTokenClass): this {
    if (text.length === 0) return this;
    const parts = text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) this.lines.push([]);
      if (part.length > 0) {
        (this.lines.at(-1) as SnippetToken[]).push(
          cls === undefined ? { text: part } : { cls, text: part },
        );
      }
    });
    return this;
  }
}

function mergeTokens(tokens: readonly SnippetToken[]): SnippetToken[] {
  const merged: SnippetToken[] = [];
  for (const token of tokens) {
    const last = merged.at(-1);
    if (last !== undefined && last.cls === token.cls) {
      merged[merged.length - 1] = { ...last, text: last.text + token.text };
    } else {
      merged.push(token);
    }
  }
  return merged;
}
