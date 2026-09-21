import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { InteractionFeedback } from "../components/InteractionFeedback";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sugar Agent · 多 Agent 协作工作台",
  description: "Sugar Studio 内部多 Agent 协作工作台 Demo",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <InteractionFeedback>{children}</InteractionFeedback>
      </body>
    </html>
  );
}
