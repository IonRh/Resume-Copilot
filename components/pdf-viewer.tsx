"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { generatePdfFilename, prepareResumeDataForPreview } from "@/lib/resume-core";
import ResumePreview from "./resume-preview";
import PdfLoading from "@/components/pdf-loading";


const FORCE_PRINT = process.env.NEXT_PUBLIC_FORCE_PRINT === "true";
const FORCE_SERVER = process.env.NEXT_PUBLIC_FORCE_SERVER_PDF === "true";
const SERVER_PDF_TIMEOUT_MS = 45000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit & { timeout?: number }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init?.timeout ?? 3000);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function checkServerPdfAvailable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/pdf/health", { method: "GET", timeout: 3000, cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return !!data.ok;
  } catch {
    return false;
  }
}

async function postServerPdf(resumeData: ResumeData, filename = generatePdfFilename(resumeData.title || "")): Promise<Response> {
  const res = await fetchWithTimeout(`/api/pdf/${filename}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resumeData }),
    timeout: SERVER_PDF_TIMEOUT_MS,
  });
  if (!res.ok) {
    // Try to surface server-side error details
    const ct = res.headers.get("content-type") || "";
    let detail = "";
    try {
      if (ct.includes("application/json")) {
        const j = await res.json();
        detail = j?.error ? String(j.error) : JSON.stringify(j);
      } else {
        detail = await res.text();
      }
    } catch { }
    throw new Error(`Failed to generate PDF (${res.status}). ${detail}`);
  }
  return res;
}

async function generateServerPdf(resumeData: ResumeData): Promise<Blob> {
  const res = await postServerPdf(resumeData);
  return await res.blob();
}

async function generateServerPdfUrl(resumeData: ResumeData, filename: string): Promise<string> {
  const res = await postServerPdf(resumeData, filename);
  return res.url || `/api/pdf/${filename}`;
}

export type Mode = "loading" | "server" | "fallback";

export function PDFViewer({
  resumeData,
  onModeChange,
  renderNotice = "internal",
  serverFilename,
}: {
  resumeData: ResumeData;
  onModeChange?: (mode: Mode) => void;
  /**
   * internal: 在组件内部渲染降级提示与打印按钮
   * external: 由外部容器负责渲染提示（组件内部不再渲染提示）
   */
  renderNotice?: "internal" | "external";
  /**
   * （可选）覆盖服务器生成 PDF 时使用的文件名路径片段。
   * 当外部容器本身位于 /pdf/preview/[filename] 这样的语义路径时，
   * 传入同名可保证服务端 URL 文件名一致。
   */
  serverFilename?: string;
}) {
  const [mode, setMode] = useState<Mode>("loading");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasServerPdfRef = useRef(false);
  const normalizedResumeData = useMemo(
    () => prepareResumeDataForPreview(resumeData),
    [resumeData]
  );
  const resumeKey = useMemo(() => JSON.stringify(normalizedResumeData), [normalizedResumeData]);
  const genIdRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let urlToRevoke: string | null = null;
    const currentId = ++genIdRef.current;
    const run = async () => {
      if (FORCE_PRINT) {
        if (mounted) setMode("fallback");
        onModeChange?.("fallback");
        return;
      }
      // 优先尝试服务器模式（若未强制打印）。
      // 为避免频繁探测，使用带 TTL 的缓存；TTL 过期后重新探测。
      let available = FORCE_SERVER;
      if (!available) {
        try {
          const KEY = "serverPdfAvailable:v1";
          const raw = sessionStorage.getItem(KEY);
          const now = Date.now();
          const ttlMs = 30 * 1000; // 30 秒
          let cachedOk: boolean | null = null;
          if (raw) {
            try {
              const rec = JSON.parse(raw) as { value: boolean; expires: number };
              if (rec && typeof rec.expires === 'number' && rec.expires > now) {
                cachedOk = !!rec.value;
              } else {
                sessionStorage.removeItem(KEY);
              }
            } catch {
              sessionStorage.removeItem(KEY);
            }
          }
          if (cachedOk === null) {
            const ok = await checkServerPdfAvailable();
            sessionStorage.setItem(KEY, JSON.stringify({ value: ok, expires: now + ttlMs }));
            available = ok;
          } else {
            available = cachedOk;
          }
        } catch {
          // 如果缓存出错，直接探测一次
          available = await checkServerPdfAvailable();
        }
      }

      if (!available) {
        if (mounted) setMode("fallback");
        onModeChange?.("fallback");
        return;
      }

      if (renderNotice === "external") {
        if (!mounted) return;
        setMode("server");
        onModeChange?.("server");
        await new Promise((r) => setTimeout(r, 0));
        try {
          const parsed: ResumeData = JSON.parse(resumeKey);
          const targetName = serverFilename || generatePdfFilename(parsed.title || "");
          const url = await generateServerPdfUrl(parsed, targetName);
          if (!mounted || genIdRef.current !== currentId) return;
          window.location.assign(url);
        } catch (e) {
          console.error(e);
          if (!mounted || genIdRef.current !== currentId) return;
          setError(e instanceof Error ? e.message : String(e));
          setMode("fallback");
          onModeChange?.("fallback");
        }
        return;
      }

      try {
        const parsed: ResumeData = JSON.parse(resumeKey);
        const blob = await generateServerPdf(parsed);
        if (!mounted) return;
        if (genIdRef.current !== currentId) return; // stale
        const url = URL.createObjectURL(blob);
        urlToRevoke = url;
        setPdfUrl(url);
        setMode("server");
        onModeChange?.("server");
        hasServerPdfRef.current = true;
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        if (genIdRef.current !== currentId) return; // stale
        setError(e instanceof Error ? e.message : String(e));
        if (!hasServerPdfRef.current) {
          setMode("fallback");
          onModeChange?.("fallback");
        }
      }
    };
    const t = setTimeout(run, 250); // small debounce to avoid thrash
    return () => {
      mounted = false;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
      clearTimeout(t);
    };
  }, [resumeKey, onModeChange, renderNotice, serverFilename]);

  if (mode === "server") {
    if (renderNotice === "external") {
      // 已触发导航到浏览器内置 PDF 查看器，这里展示一个轻量过渡状态（极短时间可见）
      return <PdfLoading message="正在打开浏览器 PDF 查看器..." />;
    }
    return (
      <object data={pdfUrl || undefined} type="application/pdf" width="100%" height="100%" style={{ border: "none" }}>
        <div className="p-6 text-center text-muted-foreground">
          无法嵌入预览，请下载后查看。
        </div>
      </object>
    );
  }

  if (mode === "loading") {
    return <PdfLoading />;
  }

  // 回退到所见即所得的 HTML 预览 + 打印指引
  return (
    <div className="w-full h-full pdf-fallback-container">
      {renderNotice === "internal" && (
        <div className="no-print p-3 border-b bg-white">
          <div className="text-sm text-muted-foreground">
            {error ? (
              <span>服务器生成失败，已切换为浏览器打印。{error}</span>
            ) : (
              <span>服务器不可用，已切换为浏览器打印。</span>
            )}
            <span className="ml-2 text-foreground">请在打印对话框中：关闭“页眉和页脚”，勾选“背景图形”。</span>
            <button
              onClick={() => {
                try {
                  const url = new URL('/print', window.location.origin);
                  url.searchParams.set('auto', '1');
                  window.open(url.toString(), '_blank', 'noopener,noreferrer');
                } catch {
                  // fallback to same-tab navigation
                  try { window.location.href = '/print?auto=1'; } catch { }
                }
              }}
              className="ml-3 inline-flex items-center px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
            >
              打开纯净打印页
            </button>
          </div>
        </div>
      )}
      <div className="pdf-preview-mode">
        <ResumePreview resumeData={normalizedResumeData} />
      </div>
    </div>
  );
}

export function PDFDownloadLink({
  resumeData,
  fileName = "resume.pdf",
  children,
}: {
  resumeData: ResumeData;
  fileName?: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const normalized = prepareResumeDataForPreview(resumeData);
    try {
      const available = FORCE_PRINT ? false : await checkServerPdfAvailable();
      if (!available) {
        alert("服务器生成不可用，请使用“打印/保存为 PDF”，并在对话框中关闭页眉页脚、勾选背景图形。");
        return;
      }
      const blob = await generateServerPdf(normalized);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("生成 PDF 失败，请稍后再试或使用浏览器打印。");
    } finally {
      setLoading(false);
    }
  }, [resumeData, fileName, loading]);

  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void; disabled?: boolean }>;
    return React.cloneElement(child, {
      onClick: handleClick,
      disabled: loading || child.props.disabled,
    });
  }
  return (
    <a href="#" onClick={handleClick}>
      {loading ? "正在生成 PDF..." : children || "下载 PDF"}
    </a>
  );
}

export default PDFViewer;
