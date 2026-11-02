// Owner: R5. Small, safe Markdown renderer for advisor narratives. It never uses
// dangerouslySetInnerHTML; only headings, lists, emphasis, code, and paragraphs.
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let unordered: string[] = [];
  let ordered: string[] = [];

  function flushLists() {
    if (unordered.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {unordered.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>,
      );
      unordered = [];
    }
    if (ordered.length > 0) {
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {ordered.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ol>,
      );
      ordered = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushLists();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushLists();
      blocks.push(<h4 key={`h4-${blocks.length}`}>{inline(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushLists();
      blocks.push(<h3 key={`h3-${blocks.length}`}>{inline(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushLists();
      blocks.push(<h3 key={`h3-${blocks.length}`}>{inline(trimmed.slice(2))}</h3>);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (ordered.length > 0) flushLists();
      unordered.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (unordered.length > 0) flushLists();
      ordered.push(trimmed.replace(/^\d+\.\s+/, ""));
      continue;
    }
    if (trimmed.startsWith("> ")) {
      flushLists();
      blocks.push(
        <blockquote key={`quote-${blocks.length}`}>{inline(trimmed.slice(2))}</blockquote>,
      );
      continue;
    }
    flushLists();
    blocks.push(<p key={`p-${blocks.length}`}>{inline(trimmed)}</p>);
  }
  flushLists();

  return <div className="markdown">{blocks}</div>;
}
