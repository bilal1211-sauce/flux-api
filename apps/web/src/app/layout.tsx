import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import localFont from "next/font/local";
import "./globals.css";

const interfaceFont = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
    },
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
    },
  ],
  variable: "--font-interface",
  display: "swap",
  fallback: ["Segoe UI", "Arial"],
});
const monoFont = localFont({
  src: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  variable: "--font-code",
  display: "swap",
  fallback: ["Consolas"],
});

export const metadata: Metadata = {
  title: "FluxAPI · API Reliability Workspace",
  description: "Build, test, and monitor your APIs in one focused workspace.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interfaceFont.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('apiforge-theme');if(t!=='light'&&t!=='dark')t=null;document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch{}",
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
