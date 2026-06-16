"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState("");
  const [authReady, setAuthReady] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "I'm your agent. I can chat, run calculations, check live weather, search the web, and answer questions about PDFs you upload. What do you need?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [file, setFile] = useState(null);
  const [collectionId, setCollectionId] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [showSessionArrow, setShowSessionArrow] = useState(false);

  const feedRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const sessionListRef = useRef(null);

  // ── Auth check on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = localStorage.getItem("token");
    const name = localStorage.getItem("username");
    if (!t) {
      router.replace("/login");
      return;
    }
    setToken(t);
    setUsername(name || "");
    setAuthReady(true);
  }, [router]);

  // ── Load sessions once auth is ready ────────────────────────────────────────
  const loadSessions = useCallback(async (t) => {
    try {
      const res = await fetch(`${API}/sessions`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) { logout(); return; }
      const data = await res.json();
      setSessions(data);
    } catch { }
  }, []); // eslint-disable-line

  useEffect(() => {
    if (authReady && token) loadSessions(token);
  }, [authReady, token, loadSessions]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Auth helpers ─────────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    router.replace("/login");
  }

  function authHeaders() {
    return { Authorization: `Bearer ${token}` };
  }

  // ── Session helpers ──────────────────────────────────────────────────────────
  async function openSession(s) {
    try {
      const res = await fetch(`${API}/sessions/${s.id}/messages`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const msgs = await res.json();
      setMessages(
        msgs.length
          ? msgs
          : [{ role: "assistant", content: "This conversation is empty." }]
      );
      setSessionId(s.id);
      setCollectionId(null);
      setFile(null);
      setIsMobileMenuOpen(false);
    } catch { }
  }

  async function deleteSession(e, id) {
    e.stopPropagation();
    await fetch(`${API}/sessions/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sessionId === id) startNew();
  }

  function startNew() {
    setMessages([
      { role: "assistant", content: "Fresh thread. What are we working on?" },
    ]);
    setSessionId(null);
    setCollectionId(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setIsMobileMenuOpen(false);
  }

  // ── Textarea autosize ────────────────────────────────────────────────────────
  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  // ── PDF helpers ──────────────────────────────────────────────────────────────
  function clearFile() {
    setFile(null);
    setCollectionId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadPdf(selectedFile) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch(`${API}/upload-pdf`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setCollectionId(data.collection_id);
    } catch (err) {
      clearFile();
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `Could not index the PDF: ${err.message}` },
      ]);
    } finally {
      setUploading(false);
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((p) => [...p, { role: "user", content: text, fileName: file?.name ?? null }]);
    setInput("");
    setLoading(true);
    if (taRef.current) taRef.current.style.height = "auto";

    try {
      let res;

      if (collectionId) {
        const formData = new FormData();
        formData.append("message", text);
        formData.append("collection_id", collectionId);
        res = await fetch(`${API}/chat-with-pdf`, {
          method: "POST",
          headers: authHeaders(),
          body: formData,
        });
      } else {
        const history = messages
          .slice(-3)
          .map((m) => ({ role: m.role, content: m.content }));
        res = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ message: text, history, session_id: sessionId }),
        });
      }

      if (res.status === 401) { logout(); return; }

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Request failed");

      if (data.session_id && data.session_id !== sessionId) {
        setSessionId(data.session_id);
        loadSessions(token);
      }

      setMessages((p) => [
        ...p,
        { role: "assistant", content: data.reply, toolUsed: data.toolUsed ?? [] },
      ]);
    } catch (err) {
      const isRateLimit =
        err.message?.toLowerCase().includes("traffic") ||
        err.message?.toLowerCase().includes("queue") ||
        err.message?.toLowerCase().includes("429");
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content: isRateLimit
            ? "The AI server is busy right now (rate limit). Please wait a moment and try again."
            : `Error: ${err.message}`,
        },
      ]);
    } finally {
      setLoading(false);
      taRef.current?.focus();
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function checkSessionScroll() {
    const el = sessionListRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 4;
    setShowSessionArrow(el.scrollHeight > el.clientHeight && !atBottom);
  }

  useEffect(() => {
    setTimeout(checkSessionScroll, 50);
  }, [sessions]);

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }

  function groupedSessions() {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const groups = { Today: [], Yesterday: [], Earlier: [] };
    sessions.forEach((s) => {
      const d = new Date(s.created_at).toDateString();
      if (d === today) groups.Today.push(s);
      else if (d === yesterday) groups.Yesterday.push(s);
      else groups.Earlier.push(s);
    });
    return groups;
  }

  const isWelcome = messages.length === 1 && !sessionId;

  if (!authReady) return null;

  return (
    <main className="nx">
      <aside className={`nx-rail ${isMobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="nx-brand">
          <span className="nx-dot" />
          <b>Veyra AI</b>
        </div>

        <div>
          <p className="nx-rail-label">Thread</p>
          <button className="nx-new" onClick={startNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New conversation
          </button>
        </div>

        {sessions.length > 0 && (
          <div className="nx-sessions">
            <p className="nx-rail-label">History</p>
            <div className={`nx-session-list${isWelcome ? " no-scroll" : ""}`} ref={sessionListRef} onScroll={checkSessionScroll}>
              {Object.entries(groupedSessions()).map(([group, items]) =>
                items.length === 0 ? null : (
                  <div key={group}>
                    <p className="nx-session-group">{group}</p>
                    {items.map((s) => (
                      <div
                        key={s.id}
                        className={`nx-session-item ${s.id === sessionId ? "active" : ""}`}
                        onClick={() => openSession(s)}
                      >
                        <div className="nx-session-meta">
                          <span className="nx-session-title">{s.title}</span>
                          <span className="nx-session-date">{formatDate(s.created_at)}</span>
                        </div>
                        <button
                          className="nx-session-del"
                          onClick={(e) => deleteSession(e, s.id)}
                          title="Delete"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
            {showSessionArrow && !isWelcome && (
              <div className="nx-session-arrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            )}
          </div>
        )}

        <div>
          <button className="nx-tools-toggle" onClick={() => setToolsOpen((o) => !o)}>
            <span>Tools available</span>
            <svg
              className={`nx-tools-chevron ${toolsOpen ? "open" : ""}`}
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={`nx-tools-dropdown ${toolsOpen ? "open" : ""}`}>
            <div className="nx-tools">
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></svg>
                Live weather
              </div>
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2" /></svg>
                Calculator
              </div>
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                Web search
              </div>
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                Read webpage
              </div>
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                Index PDF
              </div>
              <div className="nx-tool">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6M8 11h6" /></svg>
                Search PDF
              </div>
            </div>
          </div>
        </div>

        <div className="nx-foot">
          <span className="nx-user-email">{username}</span><br />
          <button className="nx-logout" onClick={logout}>Sign out</button>
        </div>
      </aside>

      {isMobileMenuOpen && (
        <div className="nx-overlay" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <section className="nx-stage">
        <header className="nx-head">
          <div className="nx-head-left">
            <button className="nx-hamburger" onClick={() => setIsMobileMenuOpen(true)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div>
              <h1>Veyra</h1>
              <p className="nx-status"><span className="nx-live" /> Ready</p>
            </div>
          </div>
          <div className="nx-badge">gpt-oss-120b · cerebras · 6 tools</div>
        </header>

        <div className="nx-feed" ref={feedRef} style={isWelcome ? { overflowY: "hidden" } : undefined}>
          {messages.length === 1 && !sessionId ? (
            <div className="nx-welcome">
              <h2 className="nx-welcome-title">What can I do for you?</h2>
              <p className="nx-welcome-sub">Ask me anything — search the web, analyze PDFs, calculate, check weather, or just chat.</p>
              <div className="nx-feature-grid">
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
                  <h3>Web Search</h3>
                  <p>Real-time information, news, and data from the internet</p>
                </div>
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
                  <h3>PDF Analysis</h3>
                  <p>Upload any document and ask questions about its content</p>
                </div>
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/><circle cx="12" cy="12" r="4"/></svg></div>
                  <h3>Live Weather</h3>
                  <p>Get current conditions for any city in the world</p>
                </div>
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2"/></svg></div>
                  <h3>Calculator</h3>
                  <p>Solve complex math expressions and equations instantly</p>
                </div>
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
                  <h3>Read Webpage</h3>
                  <p>Extract and summarize content from any URL</p>
                </div>
                <div className="nx-feature-card">
                  <div className="nx-feature-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                  <h3>AI Chat</h3>
                  <p>Natural conversation about any topic or question</p>
                </div>
              </div>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`nx-row ${m.role === "user" ? "me" : "ai"}`}>
              <div className="nx-msg">
                <div className="nx-bubble">
                  {m.role === "user" ? (
                    <>
                      <p>{m.content}</p>
                      {m.fileName && (
                        <div className="nx-file-badge">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          {m.fileName}
                        </div>
                      )}
                    </>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
                        strong: ({ children }) => <strong style={{ fontWeight: 600, color: "inherit" }}>{children}</strong>,
                        ul: ({ children }) => <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>{children}</ul>,
                        li: ({ children }) => <li style={{ margin: "4px 0" }}>{children}</li>,
                        code: ({ children }) => <code style={{ background: "rgba(0,0,0,0.2)", padding: "2px 6px", borderRadius: "4px", fontSize: "13px", fontFamily: "monospace" }}>{children}</code>,
                        table: ({ children }) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0", fontSize: "13.5px" }}>{children}</table>,
                        th: ({ children }) => <th style={{ border: "1px solid var(--line)", padding: "8px 12px", textAlign: "left", background: "rgba(0,0,0,0.15)", color: "var(--muted)", fontWeight: 600 }}>{children}</th>,
                        td: ({ children }) => <td style={{ border: "1px solid var(--line)", padding: "8px 12px", verticalAlign: "top" }}>{children}</td>,
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )}
                </div>
                {m.toolUsed && m.toolUsed.length > 0 && (
                  <div className="nx-tool-out">
                    <span className="nx-tk">tool</span>
                    {m.toolUsed.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="nx-row ai">
              <div className="nx-think"><i /><i /><i /></div>
            </div>
          )}
        </div>

        <div className="nx-composer">
          {file && (
            <div className="nx-file-attach">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span>{uploading ? `Indexing ${file.name}…` : file.name}</span>
              {!uploading && (
                <button className="nx-file-clear" onClick={clearFile} title="Remove">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}
          <div className="nx-input">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) uploadPdf(f);
              }}
            />
            <button
              className="nx-attach"
              onClick={() => fileRef.current?.click()}
              disabled={loading || uploading}
              title="Attach PDF"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder={
                uploading
                  ? `Indexing ${file?.name}…`
                  : file
                  ? `Ask about ${file.name}…`
                  : "Ask anything, or attach a PDF…"
              }
              onChange={(e) => { setInput(e.target.value); autosize(); }}
              onKeyDown={onKey}
              disabled={loading || uploading}
            />
            <button className="nx-send" onClick={send} disabled={loading || uploading || !input.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </div>
          <p className="nx-hint">Enter to send · Shift+Enter for newline · paperclip to attach PDF</p>
        </div>
      </section>
    </main>
  );
}
