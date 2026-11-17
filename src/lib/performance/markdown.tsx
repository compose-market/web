import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";

import { cn } from "@/lib/utils";

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

function LinkPreview({
  url,
  children,
  suppressedMediaUrls,
}: {
  url: string;
  children: React.ReactNode;
  suppressedMediaUrls?: ReadonlySet<string>;
}) {
  const normalized = normalizeMediaUrl(url);
  if (suppressedMediaUrls?.has(normalized)) {
    return null;
  }
  const safe = safeHref(url);
  if (!safe) {
    return <span>{children}</span>;
  }
  const media = MediaEmbed({ url: safe });
  if (media) {
    return media;
  }

  return (
    <span className="inline">
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="cm-markdown__link"
      >
        {children}
        <ExternalLink className="inline h-3 w-3 shrink-0" />
      </a>
    </span>
  );
}

const HighlightedCodeInner = function HighlightedCode({
  code,
  language = "",
  showHeader = true,
  compact = false,
  className,
}: {
  code: string;
  language?: string;
  showHeader?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [syntaxRuntime, setSyntaxRuntime] = useState<SyntaxRuntime | null>(() => cachedSyntaxRuntime);
  const copyTimeoutRef = useRef<number | null>(null);
  const cleanLanguage = language.trim().toLowerCase();

  useEffect(() => {
    if (!cleanLanguage || cleanLanguage === "mermaid" || syntaxRuntime) return;
    let active = true;
    void loadSyntaxRuntime().then((runtime) => {
      if (active) setSyntaxRuntime(runtime);
    });
    return () => {
      active = false;
    };
  }, [cleanLanguage, syntaxRuntime]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  if (cleanLanguage === "mermaid") {
    return <MermaidDiagram code={code} />;
  }

  return (
    <div className={cn("cm-code-block", compact && "cm-code-block--compact", className)}>
      {showHeader ? (
        <div className="cm-code-block__head">
          <span className="cm-code-block__lang">{cleanLanguage || "code"}</span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="cm-code-block__copy"
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      ) : null}

      {syntaxRuntime && cleanLanguage ? (
        <syntaxRuntime.SyntaxHighlighter
          style={syntaxRuntime.style}
          language={cleanLanguage}
          PreTag="div"
          customStyle={compact ? CODE_STYLE_COMPACT : CODE_STYLE_DEFAULT}
          codeTagProps={CODE_TAG_PROPS}
        >
          {code}
        </syntaxRuntime.SyntaxHighlighter>
      ) : (
        <pre className={cn("cm-code-block__pre", compact && "cm-code-block__pre--compact")}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
};

export const HighlightedCode = memo(HighlightedCodeInner);

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return "";
}

function PreBlock({ children }: { children?: React.ReactNode }) {
  const childArray = React.Children.toArray(children);
  const codeEl = childArray.find((child): child is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
    React.isValidElement(child),
  );
  const className = typeof codeEl?.props?.className === "string" ? codeEl.props.className : "";
  const langMatch = /language-([a-z0-9_+#.-]+)/i.exec(className);
  const language = langMatch ? langMatch[1] : "";
  const rawCode = codeEl ? extractNodeText(codeEl.props.children) : extractNodeText(children);
  const codeString = rawCode.replace(/\n$/, "");

  return <HighlightedCode code={codeString} language={language} />;
}

function InlineCode({
  children,
  className,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
  void _node;
  return (
    <code className={cn("cm-inline-code", className)} {...props}>
      {children}
    </code>
  );
}

export interface RendererProps {
  content: string;
  className?: string;
  suppressedMediaUrls?: ReadonlySet<string>;
}

const BASE_REMARK_PLUGINS = [remarkGfm];
const EMPTY_REHYPE_PLUGINS: unknown[] = [];

const MdH1 = ({ children }: { children?: React.ReactNode }) => <h1 className="cm-markdown__h1">{children}</h1>;
const MdH2 = ({ children }: { children?: React.ReactNode }) => <h2 className="cm-markdown__h2">{children}</h2>;
const MdH3 = ({ children }: { children?: React.ReactNode }) => <h3 className="cm-markdown__h3">{children}</h3>;
const MdH4 = ({ children }: { children?: React.ReactNode }) => <h4 className="cm-markdown__h4">{children}</h4>;
const MdP = ({ children }: { children?: React.ReactNode }) => <p className="cm-markdown__p">{children}</p>;
const MdUl = ({ children }: { children?: React.ReactNode }) => <ul className="cm-markdown__ul">{children}</ul>;
const MdOl = ({ children }: { children?: React.ReactNode }) => <ol className="cm-markdown__ol">{children}</ol>;
const MdLi = ({ children }: { children?: React.ReactNode }) => <li className="cm-markdown__li">{children}</li>;
const MdTable = ({ children }: { children?: React.ReactNode }) => (
  <div className="cm-markdown__table-wrap">
    <table className="cm-markdown__table">{children}</table>
  </div>
);
const MdThead = ({ children }: { children?: React.ReactNode }) => <thead className="cm-markdown__thead">{children}</thead>;
const MdTh = ({ children }: { children?: React.ReactNode }) => <th className="cm-markdown__th">{children}</th>;
const MdTd = ({ children }: { children?: React.ReactNode }) => <td className="cm-markdown__td">{children}</td>;
const MdTr = ({ children }: { children?: React.ReactNode }) => <tr className="cm-markdown__tr">{children}</tr>;
const MdBlockquote = ({ children }: { children?: React.ReactNode }) => (
  <blockquote className="cm-markdown__blockquote">{children}</blockquote>
);
const MdHr = () => <hr className="cm-markdown__hr" />;
const MdStrong = ({ children }: { children?: React.ReactNode }) => <strong className="cm-markdown__strong">{children}</strong>;
const MdEm = ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>;
const MdDel = ({ children }: { children?: React.ReactNode }) => <del className="opacity-60 line-through">{children}</del>;
const MdAnchorDefault = ({ href, children }: { href?: string; children?: React.ReactNode }) =>
  href ? <LinkPreview url={href}>{children}</LinkPreview> : <span>{children}</span>;
const MdImgDefault = ({ src, alt }: { src?: string; alt?: string }) => {
  const safe = safeImageSrc(src);
  if (!safe) return null;
  return (
    <img
      src={safe}
      alt={alt || "Image"}
      className="cm-stream-media cm-stream-media--image my-2"
      loading="lazy"
      decoding="async"
    />
  );
};

const STATIC_COMPONENTS = {
  pre: PreBlock as never,
  code: InlineCode as never,
  h1: MdH1,
  h2: MdH2,
  h3: MdH3,
  h4: MdH4,
  p: MdP,
  ul: MdUl,
  ol: MdOl,
  li: MdLi,
  a: MdAnchorDefault,
  img: MdImgDefault,
  table: MdTable,
  thead: MdThead,
  th: MdTh,
  td: MdTd,
  tr: MdTr,
  blockquote: MdBlockquote,
  hr: MdHr,
  strong: MdStrong,
  em: MdEm,
  del: MdDel,
};

const CODE_STYLE_DEFAULT = {
  margin: 0,
  padding: "0.85rem 1rem",
  fontSize: "0.8125rem",
  lineHeight: 1.55,
  background: "transparent",
  borderRadius: 0,
} as const;

const CODE_STYLE_COMPACT = {
  margin: 0,
  padding: "0.6rem 0.75rem",
  fontSize: "0.75rem",
  lineHeight: 1.55,
  background: "transparent",
  borderRadius: 0,
} as const;

const CODE_TAG_PROPS = {
  style: {
    background: "transparent",
    fontFamily: "var(--font-mono), monospace",
  },
} as const;

function splitMarkdownChunks(source: string): string[] {
  if (!source) return [];
  const lines = source.split("\n");
  const chunks: string[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceChar = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!inFence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      inFence = true;
      fenceChar = trimmed.slice(0, 3);
      buffer.push(line);
      continue;
    }
    if (inFence && trimmed.startsWith(fenceChar)) {
      inFence = false;
      fenceChar = "";
      buffer.push(line);
      continue;
    }
    if (!inFence && line.trim() === "" && buffer.length > 0) {
      chunks.push(buffer.join("\n"));
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length > 0) {
    chunks.push(buffer.join("\n"));
  }
  return chunks;
}

const MarkdownChunk = memo(function MarkdownChunk({
  source,
  remarkPlugins,
  rehypePlugins,
  components,
}: {
  source: string;
  remarkPlugins: unknown;
  rehypePlugins: unknown;
  components: unknown;
}) {
  const normalized = useMemo(() => normalizeExplicitLatexDelimiters(source), [source]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins as never}
      rehypePlugins={rehypePlugins as never}
      components={components as never}
    >
      {normalized}
    </ReactMarkdown>
  );
});

const MarkdownTextBlock = memo(function MarkdownTextBlock({
  content,
  remarkPlugins,
  rehypePlugins,
  components,
}: {
  content: string;
  remarkPlugins: unknown;
  rehypePlugins: unknown;
  components: unknown;
}) {
  const chunks = useMemo(() => splitMarkdownChunks(content), [content]);
  return (
    <>
      {chunks.map((chunk, idx) => (
        <MarkdownChunk
          key={idx}
          source={chunk}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        />
      ))}
    </>
  );
});

function MarkdownRendererInner({ content, className, suppressedMediaUrls }: RendererProps) {
  const [mathRuntime, setMathRuntime] = useState<MathRuntime | null>(() => cachedMathRuntime);

  const requiresMathRuntime = useMemo(
    () => /(^|[^\\])(?:\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.test(content),
    [content],
  );

  useEffect(() => {
    if (!requiresMathRuntime || mathRuntime) return;

    let active = true;
    void loadMathRuntime().then((runtime) => {
      if (active) setMathRuntime(runtime);
    });

    return () => {
      active = false;
    };
  }, [mathRuntime, requiresMathRuntime]);

  const remarkPlugins = useMemo(
    () => (requiresMathRuntime && mathRuntime?.remarkPlugins?.length
      ? [remarkGfm, ...mathRuntime.remarkPlugins]
      : BASE_REMARK_PLUGINS),
    [mathRuntime, requiresMathRuntime],
  );

  const rehypePlugins = useMemo(
    () => (requiresMathRuntime && mathRuntime?.rehypePlugins?.length
      ? mathRuntime.rehypePlugins
      : EMPTY_REHYPE_PLUGINS),
    [mathRuntime, requiresMathRuntime],
  );

  const components = useMemo(() => {
    if (!suppressedMediaUrls || suppressedMediaUrls.size === 0) {
      return STATIC_COMPONENTS;
    }
    return {
      ...STATIC_COMPONENTS,
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
        href ? (
          <LinkPreview url={href} suppressedMediaUrls={suppressedMediaUrls}>
            {children}
          </LinkPreview>
        ) : (
          <span>{children}</span>
        ),
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (src && suppressedMediaUrls.has(normalizeMediaUrl(src))) {
          return null;
        }
        const safe = safeImageSrc(src);
        if (!safe) return null;
        return (
          <img
            src={safe}
            alt={alt || "Image"}
            className="cm-stream-media cm-stream-media--image my-2"
            loading="lazy"
            decoding="async"
          />
        );
      },
    };
  }, [suppressedMediaUrls]);

  if (!content) {
    return <span className="text-muted-foreground">...</span>;
  }

  return (
    <div className={cn("cm-markdown renderer-content", className)}>
      <MarkdownTextBlock
        content={content}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      />
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
export default MarkdownRenderer;
