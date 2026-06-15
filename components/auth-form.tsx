"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock, UserPlus } from "lucide-react";

export default function AuthForm({
  from,
  errorMessage,
}: {
  from: string;
  errorMessage: string;
}) {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("admin");
  const [pwd, setPwd] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex w-full max-w-md justify-self-center lg:h-full lg:flex-col lg:justify-end lg:justify-self-end">
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-background/85 shadow-xl shadow-primary/10 backdrop-blur-md">
        <div className="px-6 pt-6 pb-4 flex items-center gap-3">
          <div className="brand-icon-bg size-11 rounded-2xl flex items-center justify-center">
            <Lock className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">登录智简Copilot</h1>
          </div>
        </div>

        <form method="post" action="/api/auth" className="px-6 pb-6 pt-2">
          {errorMessage ? (
            <div className="mb-3 text-sm rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2">
              {errorMessage}
            </div>
          ) : null}

          <input type="hidden" name="from" value={from || "/"} />
          <input type="hidden" name="mode" value={mode} />
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                mode === "login" ? "brand-pill-bg border-transparent" : "bg-background hover:bg-muted"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-lg border px-3 py-2 text-sm font-medium inline-flex items-center justify-center gap-1.5 ${
                mode === "register" ? "brand-pill-bg border-transparent" : "bg-background hover:bg-muted"
              }`}
            >
              <UserPlus className="size-4" />
              注册
            </button>
          </div>

          <div className="mt-2 mb-3">
            <input
              id="username"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/30"
              placeholder="用户名"
              aria-label="用户名"
              autoComplete="username"
            />
          </div>

          <div className="relative mb-4">
            <input
              id="password"
              name="password"
              ref={inputRef}
              type={show ? "text" : "password"}
              required
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 pr-10 text-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/30"
              placeholder="输入密码"
              aria-label="密码"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            <button
              type="button"
              aria-label={show ? "隐藏密码" : "显示密码"}
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/80 hover:text-foreground/90 p-1"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={!username.trim() || !pwd}
            className="brand-pill-bg w-full rounded-lg border-0 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === "login" ? "登录" : "注册并开始使用"}
          </button>
        </form>
      </div>
    </div>
  );
}
