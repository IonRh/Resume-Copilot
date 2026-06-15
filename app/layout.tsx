import type React from "react";
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import "../styles/print.css";
import "../styles/tiptap.css";
import "./globals.css";
import { Toaster } from "@/components/toaster";
import { ColorPickerProvider } from "@/components/color-picker-manager";
import { ToolbarProvider } from "@/components/rich-text-toolbar-manager";
import localFont from "next/font/local";

// 定义 NotoSansSC 字体
const notoSansSC = localFont({
  src: "../public/NotoSansSC-Medium.ttf",
  variable: "--font-noto-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "简历生成器",
  description: "在线简历编辑与生成工具",
  generator: "wzdnzd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={notoSansSC.variable}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <style>{`
html {
  font-family: var(--font-noto-sans), sans-serif;
  --font-sans: var(--font-noto-sans);
  --font-mono: ${GeistMono.variable};
}
        `}</style>
        {/** 合并打印样式到 styles/print.css，移除单独的 public/styles/print-resume.css 引用 */}
      </head>
      <body className={notoSansSC.className}>
        <ColorPickerProvider>
          <ToolbarProvider>
            {children}
            <Toaster />
          </ToolbarProvider>
        </ColorPickerProvider>
      </body>
    </html>
  );
}
