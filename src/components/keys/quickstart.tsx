/**
 * QuickstartPanel — "Connect your tools" guide for the Keys page.
 *
 * Two paths:
 *  - Integrate your app: the native Responses API (one endpoint, every
 *    modality, verifiable receipts) + drop-in OpenAI SDK config.
 *  - Use in your IDE: the three values every OpenAI-compatible client
 *    needs, plus per-client recipes (OpenCode, OpenClaw, Hermes) pulled
 *    straight from docs/inference/external-use.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Terminal } from "lucide-react";
import { toast } from "@/hooks/use-toast";

import {
  BEARER_FORMAT,
  CURL_EXTERNAL,
  CURL_RESPONSES,
  DOCS_EXTERNAL_USE,
  ENV_EXPORT,
  EXTERNAL_BASE_URL,
  MODELS_ENDPOINT,
  OPENCODE_AUTH,
  OPENCODE_JSON,
  SDK_PYTHON,
  SDK_TYPESCRIPT,
} from "./snippets";

export type QuickstartSegment = "integrate" | "ide";

// ── Lazy syntax highlighting (react-syntax-highlighter, code-split) ──

interface SyntaxRuntime {
  SyntaxHighlighter: typeof import("react-syntax-highlighter")["Prism"];
  style: typeof import("react-syntax-highlighter/dist/esm/styles/prism")["oneDark"];
}

let syntaxRuntimePromise: Promise<SyntaxRuntime> | null = null;

function loadSyntaxRuntime(): Promise<SyntaxRuntime> {
  if (!syntaxRuntimePromise) {
    syntaxRuntimePromise = Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/esm/styles/prism"),
    ]).then(([syntaxModule, styleModule]) => ({
      SyntaxHighlighter: syntaxModule.Prism,
      style: styleModule.oneDark,
    }));
  }
  return syntaxRuntimePromise;
}

// Prefetch the highlighting runtime as soon as this module is evaluated —
// snippets render instantly as styled <pre>, highlighting enhances in place.
if (typeof window !== "undefined") {
  const prefetch = () => void loadSyntaxRuntime();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(prefetch, { timeout: 1500 });
  } else {
    window.setTimeout(prefetch, 200);
  }
}

function useCopied(): [string | null, (id: string, value: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  const copy = (id: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedId(id);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return [copiedId, copy];
}

function SnippetBlock({ code, language, label }: { code: string; language: string; label?: string }) {
  const [runtime, setRuntime] = useState<SyntaxRuntime | null>(null);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void loadSyntaxRuntime().then((loaded) => {
      if (active) setRuntime(loaded);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="cm-snippet">
      <div className="cm-snippet__bar">
        <span className="cm-snippet__lang">{label ?? language}</span>
        <button type="button" className="cm-snippet__copy" onClick={handleCopy} aria-label="Copy snippet">
          {copied ? <Check className="cm-snippet__copy-icon" data-state="done" /> : <Copy className="cm-snippet__copy-icon" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {runtime ? (
        <runtime.SyntaxHighlighter
          style={runtime.style}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "0.75rem",
            fontSize: "var(--font-xs)",
            lineHeight: 1.52,
            background: "hsl(240 10% 4% / 0.55)",
            borderRadius: 0,
            overflowX: "hidden",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
          codeTagProps={{
            style: {
              fontFamily: "var(--font-mono), monospace",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            },
          }}
        >
          {code}
        </runtime.SyntaxHighlighter>
      ) : (
        <pre className="cm-snippet__pre"><code>{code}</code></pre>
      )}
    </div>
  );
}

function CopyRow({ id, label, value, copiedId, onCopy }: {
  id: string;
  label: string;
  value: string;
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
}) {
  const copied = copiedId === id;
  return (
    <div className="cm-config-row">
      <span className="cm-config-row__label">{label}</span>
      <code className="cm-config-row__value">{value}</code>
      <button
        type="button"
        className="cm-config-row__copy"
        onClick={() => onCopy(id, value)}
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="cm-snippet__copy-icon" data-state="done" /> : <Copy className="cm-snippet__copy-icon" />}
      </button>
    </div>
  );
}

// ── Integrate your app ──

type DevSnippetTab = "curl" | "python" | "typescript";

function IntegratePane({
  sessionActive,
  onCreateSession,
  onCreateKey,
}: {
  sessionActive: boolean;
  onCreateSession?: () => void;
  onCreateKey?: () => void;
}) {
  const [tab, setTab] = useState<DevSnippetTab>("curl");

  return (
    <>
      <div className="cm-quickstart__hero">
        <span className="cm-quickstart__hero-title">One endpoint. Every modality.</span>
        <span className="cm-quickstart__hero-copy">
          No need for <code>/chat/completions</code>, <code>/[images|video]/generations</code>,{" "}
          <code>/audio/speech</code>, <code>/embeddings</code> and the like. Compose&apos;s native{" "}
          <code>POST /v1/responses</code> gives you access to <b>text, image, audio, video, embeddings</b> etc from a single endpoint.
        </span>
      </div>

      <div className="cm-quickstart__steps">
        <button
          type="button"
          className="cm-quickstart__step"
          data-active={sessionActive ? undefined : "true"}
          data-complete={sessionActive ? "true" : undefined}
          onClick={onCreateSession}
          disabled={sessionActive}
          aria-label={sessionActive ? "Session Active" : "Create a Session"}
        >
          <strong>1</strong>{sessionActive ? "Session Active" : "Create a Session"}
        </button>
        <button
          type="button"
          className="cm-quickstart__step"
          data-active="true"
          onClick={onCreateKey}
          aria-label="Export a Compose Key"
        >
          <strong>2</strong>Export a Compose Key
        </button>
        <span className="cm-quickstart__step"><strong>3</strong>Export the env var</span>
        <span className="cm-quickstart__step"><strong>4</strong>Call /v1/responses</span>
      </div>

      <SnippetBlock code={ENV_EXPORT} language="bash" label="env" />

      <div className="cm-time-range cm-quickstart__tabs">
        <button type="button" className="cm-time-range__option" data-active={tab === "curl"} onClick={() => setTab("curl")}>cURL</button>
        <button type="button" className="cm-time-range__option" data-active={tab === "python"} onClick={() => setTab("python")}>Python</button>
        <button type="button" className="cm-time-range__option" data-active={tab === "typescript"} onClick={() => setTab("typescript")}>TypeScript</button>
      </div>

      {tab === "curl" ? (
        <SnippetBlock code={CURL_RESPONSES} language="bash" label="/v1/responses" />
      ) : tab === "python" ? (
        <SnippetBlock code={SDK_PYTHON} language="python" label="openai sdk" />
      ) : (
        <SnippetBlock code={SDK_TYPESCRIPT} language="typescript" label="openai sdk" />
      )}

      <div className="cm-quickstart__note">
        Already on the OpenAI SDK? Keep your code and point it at{" "}
        <code>{EXTERNAL_BASE_URL}</code> — full OpenAI-compatible surface, same key.
      </div>
      <SnippetBlock code={CURL_EXTERNAL} language="bash" label="/external/v1" />
    </>
  );
}

// ── Use in your IDE ──

type ClientTab = "opencode" | "openclaw" | "hermes";

function IdePane() {
  const [client, setClient] = useState<ClientTab>("opencode");
  const [copiedId, copy] = useCopied();

  return (
    <>
      <div className="cm-quickstart__hero">
        <span className="cm-quickstart__hero-title">Three values. Any client.</span>
        <span className="cm-quickstart__hero-copy">
          Every OpenAI-compatible tool only needs a base URL, your Compose Key, and a model ID
          from the live catalog.
        </span>
      </div>

      <div className="cm-config-card">
        <CopyRow id="base" label="Base URL" value={EXTERNAL_BASE_URL} copiedId={copiedId} onCopy={copy} />
        <CopyRow id="auth" label="API key" value={BEARER_FORMAT} copiedId={copiedId} onCopy={copy} />
        <CopyRow id="models" label="Models" value={MODELS_ENDPOINT} copiedId={copiedId} onCopy={copy} />
      </div>

      <div className="cm-time-range cm-quickstart__tabs">
        <button type="button" className="cm-time-range__option" data-active={client === "opencode"} onClick={() => setClient("opencode")}>OpenCode</button>
        <button type="button" className="cm-time-range__option" data-active={client === "openclaw"} onClick={() => setClient("openclaw")}>OpenClaw</button>
        <button type="button" className="cm-time-range__option" data-active={client === "hermes"} onClick={() => setClient("hermes")}>Hermes</button>
      </div>

      {client === "opencode" ? (
        <div className="cm-quickstart__client">
          <div className="cm-quickstart__client-step">
            <span className="cm-quickstart__client-step-label">1 · Add the provider to ~/.config/opencode/opencode.json</span>
            <SnippetBlock code={OPENCODE_JSON} language="json" label="opencode.json" />
          </div>
          <div className="cm-quickstart__client-step">
            <span className="cm-quickstart__client-step-label">2 · Authenticate once (registers dynamic model discovery)</span>
            <SnippetBlock code={OPENCODE_AUTH} language="bash" label="terminal" />
          </div>
          <div className="cm-quickstart__client-step">
            <span className="cm-quickstart__client-step-label">3 · In the OpenCode TUI, run /connect → select compose-market → paste your key</span>
          </div>
          <div className="cm-quickstart__client-step">
            <span className="cm-quickstart__client-step-label">4 · Start OpenCode — /models shows the live Compose catalog</span>
          </div>
          <div className="cm-quickstart__note">
            OpenCode speaks the native Responses dialect through <code>/.well-known/opencode</code> — models are
            fetched dynamically on every startup, and when a key expires you only re-run <code>/connect</code>.
          </div>
        </div>
      ) : client === "openclaw" ? (
        <div className="cm-quickstart__client">
          <div className="cm-quickstart__note">
            Point OpenClaw at the three values above. Select <code>openai-responses</code> for the native Responses
            API — choose <code>openai-completions</code> only if you want plain Chat Completions. The same Compose
            Key and base URL serve both dialects.
          </div>
          <SnippetBlock code={CURL_EXTERNAL} language="bash" label="verify with curl" />
        </div>
      ) : (
        <div className="cm-quickstart__client">
          <div className="cm-quickstart__note">
            Hermes custom endpoints default to <code>chat_completions</code> — keep that default with the values
            above. If your Hermes config explicitly sets <code>api_mode: codex_responses</code>, point it at the
            same base URL — just never mix Chat tool messages and Responses items in one turn.
          </div>
          <SnippetBlock code={CURL_EXTERNAL} language="bash" label="verify with curl" />
        </div>
      )}
    </>
  );
}

// ── Panel ──

export function QuickstartPanel({
  segment,
  onSegmentChange,
  highlight = false,
  sessionActive = false,
  onCreateSession,
  onCreateKey,
}: {
  segment: QuickstartSegment;
  onSegmentChange: (segment: QuickstartSegment) => void;
  highlight?: boolean;
  sessionActive?: boolean;
  onCreateSession?: () => void;
  onCreateKey?: () => void;
}) {
  return (
    <aside className="cm-quickstart" data-highlight={highlight ? "true" : undefined} aria-label="Connect your tools">
      <div className="cm-quickstart__header">
        <span className="cm-quickstart__title">
          <Terminal className="cm-quickstart__title-icon" />
          Connect your tools
        </span>
        <a
          href={DOCS_EXTERNAL_USE}
          target="_blank"
          rel="noopener noreferrer"
          className="cm-quickstart__docs-link"
        >
          Docs <ExternalLink className="cm-quickstart__docs-icon" />
        </a>
      </div>

      <div className="cm-quickstart__segment" role="tablist" aria-label="Setup path">
        <button
          type="button"
          role="tab"
          aria-selected={segment === "integrate"}
          className="cm-quickstart__seg"
          data-active={segment === "integrate"}
          onClick={() => onSegmentChange("integrate")}
        >
          In Your App
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === "ide"}
          className="cm-quickstart__seg"
          data-active={segment === "ide"}
          onClick={() => onSegmentChange("ide")}
        >
          IDE / Agent
        </button>
      </div>

      <div className="cm-quickstart__body">
        {segment === "integrate" ? (
          <IntegratePane
            sessionActive={sessionActive}
            onCreateSession={onCreateSession}
            onCreateKey={onCreateKey}
          />
        ) : <IdePane />}
      </div>
    </aside>
  );
}
