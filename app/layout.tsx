import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "私人工具箱",
  description: "个人学习与日常使用工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
