import { useMemo, useState, type ReactNode } from "react";
import { Button, Tooltip, cn } from "@cloudflare/kumo";
import {
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  TextAlignLeftIcon,
  ArrowsOutSimpleIcon,
  ArrowsInSimpleIcon,
} from "@phosphor-icons/react";
import { prettifyPayload } from "../lib/format";
import { copyToClipboard } from "../lib/hooks";

const TOKEN_RE =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Splits pretty-printed JSON into highlighted tokens. */
function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(json.slice(last, idx));
    const token = m[0];
    let cls = "json-number";
    if (token.startsWith('"')) cls = m[2] ? "json-key" : "json-string";
    else if (/true|false|null/.test(token)) cls = "json-literal";
    out.push(
      <span key={i++} className={cls}>
        {token}
      </span>,
    );
    last = idx + token.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

interface JsonViewProps {
  value: string;
  /** Name used when downloading the content. */
  filename?: string;
  /** Collapsed height in pixels before the "Expand" toggle is needed. */
  collapsedHeight?: number;
  className?: string;
}

/** Read-only view of a payload or result with JSON highlighting, copy and download. */
export function JsonView({ value, filename = "payload", collapsedHeight = 320, className }: JsonViewProps) {
  const { text, isJson } = useMemo(() => prettifyPayload(value), [value]);
  const highlighted = useMemo(() => (isJson && text.length < 200_000 ? highlight(text) : text), [text, isJson]);
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineCount = text.split("\n").length;
  const isLong = lineCount > collapsedHeight / 20;

  const handleCopy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([text], { type: isJson ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.${isJson ? "json" : "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!value) {
    return <span className="text-sm text-kumo-subtle">Empty</span>;
  }

  return (
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-lg bg-kumo-recessed ring ring-kumo-hairline",
        className,
      )}
    >
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 rounded-md bg-kumo-recessed/90 p-0.5">
        <Tooltip
          content={wrap ? "Disable line wrap" : "Wrap lines"}
          render={
            <Button
              size="xs"
              variant="ghost"
              shape="square"
              icon={TextAlignLeftIcon}
              aria-label="Toggle line wrap"
              aria-pressed={wrap}
              onClick={() => setWrap((w) => !w)}
            />
          }
        />
        <Tooltip
          content="Download"
          render={
            <Button
              size="xs"
              variant="ghost"
              shape="square"
              icon={DownloadSimpleIcon}
              aria-label="Download"
              onClick={handleDownload}
            />
          }
        />
        <Tooltip
          content={copied ? "Copied" : "Copy"}
          render={
            <Button
              size="xs"
              variant="ghost"
              shape="square"
              icon={copied ? CheckIcon : CopyIcon}
              aria-label="Copy to clipboard"
              onClick={handleCopy}
            />
          }
        />
      </div>
      <pre
        className={cn(
          "overflow-auto p-3 pr-24 font-mono text-xs leading-5 text-kumo-default",
          wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
        )}
        style={{ maxHeight: isLong && !expanded ? collapsedHeight : undefined }}
      >
        {highlighted}
      </pre>
      {isLong && (
        <div className="flex justify-center border-t border-kumo-hairline py-1">
          <Button
            size="xs"
            variant="ghost"
            icon={expanded ? ArrowsInSimpleIcon : ArrowsOutSimpleIcon}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Collapse" : `Expand (${lineCount} lines)`}
          </Button>
        </div>
      )}
    </div>
  );
}
