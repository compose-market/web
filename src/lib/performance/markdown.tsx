import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";

import { cn } from "@/lib/utils";

type BlockType = "text" | "think" | "invoke";

interface ContentBlock {
  type: BlockType;
  content: string;
  toolName?: string;
  params?: Record<string, unknown>;
}

interface MathRuntime {
  remarkPlugins: unknown[];
  rehypePlugins: unknown[];
}

interface SyntaxRuntime {
  SyntaxHighlighter: typeof import("react-syntax-highlighter")["Prism"];
  style: Record<string, React.CSSProperties>;
}

let mathRuntimePromise: Promise<MathRuntime> | null = null;
let cachedMathRuntime: MathRuntime | null = null;
let syntaxRuntimePromise: Promise<SyntaxRuntime> | null = null;
let cachedSyntaxRuntime: SyntaxRuntime | null = null;
let mermaidRuntimePromise: Promise<typeof import("mermaid").default> | null = null;
let domPurifyPromise: Promise<typeof import("dompurify").default> | null = null;
let mermaidInitialized = false;

const SAFE_HREF_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Strict URL allowlist preventing javascript:, data:, and vbscript: XSS.
 * Returns normalized safe URL or null if disallowed.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!SAFE_HREF_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function safeImageSrc(src: string | null | undefined): string | null {
  if (!src || typeof src !== "string") return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (SAFE_DATA_IMAGE_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith("blob:")) return trimmed;
  const href = safeHref(trimmed);
  if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
    return href;
  }
  return null;
}

async function loadDomPurify(): Promise<typeof import("dompurify").default> {
  if (!domPurifyPromise) {
    domPurifyPromise = import("dompurify").then((module) => module.default);
  }
  return domPurifyPromise;
}

function stripThemeBackgrounds(
  theme: Record<string, React.CSSProperties>,
): Record<string, React.CSSProperties> {
  const cleaned: Record<string, React.CSSProperties> = {};
  for (const [selector, rules] of Object.entries(theme)) {
    if (!rules || typeof rules !== "object") continue;
    const next: React.CSSProperties = { ...rules };
    delete next.background;
    delete next.backgroundColor;
    cleaned[selector] = next;
  }
  return cleaned;
}

function loadMathRuntime(): Promise<MathRuntime> {
  if (!mathRuntimePromise) {
    mathRuntimePromise = Promise.all([
      import("remark-math"),
      import("rehype-katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([remarkMathModule, rehypeKatexModule]) => {
      cachedMathRuntime = {
        remarkPlugins: [[remarkMathModule.default, { singleDollarTextMath: false }]],
        rehypePlugins: [rehypeKatexModule.default],
      };
      return cachedMathRuntime;
    });
  }

  return mathRuntimePromise;
}

function normalizeExplicitLatexDelimiters(raw: string): string {
  if (!raw || !/\\\(|\\\[/.test(raw)) {
    return raw;
  }
  return raw
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
        .replace(/\\\(([^\n]+?)\\\)/g, (_match, expr: string) => `$$${expr.trim()}$$`);
    })
    .join("");
}

function loadSyntaxRuntime(): Promise<SyntaxRuntime> {
  if (!syntaxRuntimePromise) {
    syntaxRuntimePromise = Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/esm/styles/prism"),
    ]).then(([syntaxModule, styleModule]) => {
      cachedSyntaxRuntime = {
        SyntaxHighlighter: syntaxModule.Prism,
        style: stripThemeBackgrounds(styleModule.oneDark as Record<string, React.CSSProperties>),
      };
      return cachedSyntaxRuntime;
    });
  }

  return syntaxRuntimePromise;
}

async function loadMermaidRuntime(): Promise<typeof import("mermaid").default> {
  if (!mermaidRuntimePromise) {
    mermaidRuntimePromise = import("mermaid").then((module) => module.default);
  }

  const mermaid = await mermaidRuntimePromise;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      themeVariables: {
        primaryColor: "#06b6d4",
        primaryTextColor: "#fff",
        primaryBorderColor: "#0891b2",
        lineColor: "#64748b",
        secondaryColor: "#6366f1",
        tertiaryColor: "#0d1322",
        background: "#0d1322",
        mainBkg: "#0d1322",
        nodeBorder: "#0891b2",
      },
    });
    mermaidInitialized = true;
  }

  return mermaid;
}

export function normalizeMediaUrl(url: string): string {
  return url.trim().replace(/[)\]>.,;]+$/, "");
}

function parseBlocks(raw: string): ContentBlock[] {
  if (!raw) {
    return [];
  }

  const blocks: ContentBlock[] = [];
  const regex = /(?:<think>([\s\S]*?)<\/think>)|(?:<invoke>([\s\S]*?)<\/invoke>)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const text = raw.substring(lastIndex, match.index).trim();
      if (text) {
        blocks.push({ type: "text", content: text });
      }
    }

    if (match[1]) {
      blocks.push({ type: "think", content: match[1].trim() });
    } else if (match[2]) {
      const invokeContent = match[2].trim();
      const lines = invokeContent.split("\n");
      const toolName = lines[0]?.trim() || "Unknown Tool";
      const params: Record<string, unknown> = {};
      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        try {
          params[paramMatch[1]] = JSON.parse(paramMatch[2]);
        } catch {
          params[paramMatch[1]] = paramMatch[2].trim();
        }
      }

      blocks.push({
        type: "invoke",
        content: invokeContent,
        toolName,
        params,
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    const text = raw.substring(lastIndex).trim();
    if (text) {
      blocks.push({ type: "text", content: text });
    }
  }

  return blocks;
}

function ThinkBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-900/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
        title="Toggle Chain of Thought"
        type="button"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <span className="text-cyan-500">💭</span>
            Chain of Thought
          </span>
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {isOpen ? (
        <div className="animate-in slide-in-from-top-1 fade-in px-3 py-2 text-xs italic leading-relaxed text-zinc-500 duration-200 border-t border-zinc-700/50 whitespace-pre-wrap">
          {content}
        </div>
      ) : null}
    </div>
  );
}

function InvokeBlock({ toolName, params }: { toolName: string; params?: Record<string, unknown> }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = toolName.replace(/^Mcp:/i, "");

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-xs text-fuchsia-300 transition-colors hover:bg-fuchsia-500/10 hover:text-fuchsia-200"
        title="Toggle Tool Usage"
        type="button"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <Wrench className="h-3.5 w-3.5" />
            Used <span className="rounded bg-fuchsia-500/20 px-1 py-0.5 font-mono text-[10px]">{displayName}</span>
          </span>
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {isOpen && params && Object.keys(params).length > 0 ? (
        <div className="animate-in slide-in-from-top-1 fade-in overflow-x-auto border-t border-fuchsia-500/20 bg-black/20 px-3 py-2 text-xs text-zinc-400 duration-200">
          {Object.entries(params).map(([key, value]) => (
            <div key={key} className="mb-1 last:mb-0">
              <span className="text-fuchsia-500/70">{key}:</span>{" "}
              <span className="whitespace-pre-wrap text-zinc-300">
                {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const timer = window.setTimeout(async () => {
      try {
        const [mermaid, DOMPurify] = await Promise.all([
          loadMermaidRuntime(),
          loadDomPurify(),
        ]);
        const id = `mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const rendered = await mermaid.render(id, code);
        if (!active) return;
        const cleanSvg = DOMPurify.sanitize(rendered.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
        });
        setSvg(cleanSvg);
        setError("");
      } catch (renderError) {
        if (!active) return;
        setError(renderError instanceof Error ? renderError.message : "Failed to render diagram");
      }
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!svg) {
      el.replaceChildren();
      return;
    }
    const maybeSanitized = el as HTMLDivElement & { setHTML?: (html: string) => void };
    if (typeof maybeSanitized.setHTML === "function") {
      maybeSanitized.setHTML(svg);
      return;
    }
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === "svg") {
      el.replaceChildren(document.importNode(root, true));
    } else {
      el.replaceChildren();
    }
  }, [svg]);

  if (error) {
    return (
      <div className="cm-stream-notice my-3" data-tone="error">
        <div className="cm-stream-notice__title">Diagram error</div>
        <div className="cm-stream-notice__body">{error}</div>
        <pre className="cm-code-block__pre mt-2">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="cm-code-block my-3 flex justify-center overflow-auto p-4"
    />
  );
}

function MediaEmbed({ url }: { url: string }) {
  const safe = safeHref(url);
  if (!safe || safe.startsWith("mailto:")) return null;

  const youtubeMatch = safe.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  if (youtubeMatch) {
    return (
      <div className="my-3 aspect-video overflow-hidden rounded-lg">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeMatch[1]}`}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  const vimeoMatch = safe.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return (
      <div className="my-3 aspect-video overflow-hidden rounded-lg">
        <iframe
          src={`https://player.vimeo.com/video/${vimeoMatch[1]}`}
          className="h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(safe)) {
    return (
      <video controls className="cm-stream-media cm-stream-media--video my-3">
        <source src={safe} />
      </video>
    );
  }

  if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(safe)) {
    return (
      <audio controls className="cm-stream-media cm-stream-media--audio my-3">
        <source src={safe} />
      </audio>
    );
  }

  return null;
}

function LinkPreview({ url, children }: { url: string; children: React.ReactNode }) {
  const media = MediaEmbed({ url });
  if (media) {
    return media;
  }

  return (
    <span className="inline">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
      >
        {children}
        <ExternalLink className="inline h-3 w-3" />
      </a>
    </span>
  );
}

function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [syntaxRuntime, setSyntaxRuntime] = useState<SyntaxRuntime | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeString = String(children).replace(/\n$/, "");

  useEffect(() => {
    if (inline || language === "mermaid" || !language) {
      return;
    }

    let active = true;
    void loadSyntaxRuntime().then((runtime) => {
      if (active) {
        setSyntaxRuntime(runtime);
      }
    });

    return () => {
      active = false;
    };
  }, [inline, language]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString);
    setCopied(true);
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return (
      <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-sm text-cyan-300" {...props}>
        {children}
      </code>
    );
  }

  if (language === "mermaid") {
    return <MermaidDiagram code={codeString} />;
  }

  if (!language || !syntaxRuntime) {
    return (
      <div className="group relative my-3">
        <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
          {language ? <span className="font-mono text-xs uppercase text-zinc-500">{language}</span> : null}
          <button
            onClick={() => void handleCopy()}
            className="rounded bg-zinc-700/80 p-1.5 text-zinc-400 opacity-0 transition-colors group-hover:opacity-100 hover:bg-zinc-600 hover:text-white"
            title="Copy code"
            type="button"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        <pre className="overflow-auto rounded-lg bg-[rgb(30_30_30)] p-4 text-sm text-zinc-100">
          <code {...props}>{codeString}</code>
        </pre>
      </div>
    );
  }

  const { SyntaxHighlighter, style } = syntaxRuntime;

  return (
    <div className="group relative my-3">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        {language ? <span className="font-mono text-xs uppercase text-zinc-500">{language}</span> : null}
        <button
          onClick={() => void handleCopy()}
          className="rounded bg-zinc-700/80 p-1.5 text-zinc-400 opacity-0 transition-colors group-hover:opacity-100 hover:bg-zinc-600 hover:text-white"
          title="Copy code"
          type="button"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      <SyntaxHighlighter
        style={style}
        language={language || "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: "0.5rem",
          padding: "1rem",
          fontSize: "0.875rem",
          background: "rgb(30 30 30)",
        }}
        {...props}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

interface RendererProps {
  content: string;
  className?: string;
}

function MarkdownRendererInner({ content, className }: RendererProps) {
  const [mathRuntime, setMathRuntime] = useState<MathRuntime | null>(null);

  const requiresMathRuntime = useMemo(
    () => /(^|[^\\])(?:\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\(|\\\[)/.test(content),
    [content],
  );

  useEffect(() => {
    if (!requiresMathRuntime) {
      return;
    }

    let active = true;
    void loadMathRuntime().then((runtime) => {
      if (active) {
        setMathRuntime(runtime);
      }
    });

    return () => {
      active = false;
    };
  }, [requiresMathRuntime]);

  if (!content) {
    return <span className="text-zinc-500">...</span>;
  }

  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className={cn("renderer-content text-sm", className)}>
      {blocks.map((block, index) => (
        <React.Fragment key={`${block.type}-${index}`}>
          {block.type === "think" ? <ThinkBlock content={block.content} /> : null}

          {block.type === "invoke" && block.toolName ? (
            <InvokeBlock toolName={block.toolName} params={block.params} />
          ) : null}

          {block.type === "text" ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, ...(mathRuntime?.remarkPlugins ?? [])] as never}
              rehypePlugins={(mathRuntime?.rehypePlugins ?? []) as never}
              components={{
                code: CodeBlock as never,
                h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-bold text-white">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-2 mt-3 text-lg font-semibold text-white">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-1 mt-2 text-base font-semibold text-white">{children}</h3>,
                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-inside list-disc space-y-1 pl-2">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-inside list-decimal space-y-1 pl-2">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                a: ({ href, children }) =>
                  href ? <LinkPreview url={href}>{children}</LinkPreview> : <span>{children}</span>,
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt || "Image"}
                    className="my-2 max-w-full rounded-lg"
                    loading="lazy"
                    decoding="async"
                  />
                ),
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto">
                    <table className="w-full border-collapse border border-zinc-700 text-sm">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-zinc-800">{children}</thead>,
                th: ({ children }) => (
                  <th className="border border-zinc-700 px-3 py-2 text-left font-semibold text-white">{children}</th>
                ),
                td: ({ children }) => <td className="border border-zinc-700 px-3 py-2">{children}</td>,
                tr: ({ children }) => <tr className="even:bg-zinc-800/50">{children}</tr>,
                blockquote: ({ children }) => (
                  <blockquote className="my-2 border-l-4 border-cyan-500 pl-4 italic text-zinc-400">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-4 border-zinc-700" />,
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                del: ({ children }) => <del className="text-zinc-500 line-through">{children}</del>,
              }}
            >
              {block.content}
            </ReactMarkdown>
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
export default MarkdownRenderer;
