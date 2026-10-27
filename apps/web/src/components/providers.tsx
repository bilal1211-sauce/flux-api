"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { clearDrafts, hasUnsavedDrafts } from "@/lib/drafts";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedDrafts()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const unauthorized = () => {
      if (
        ["/forgot-password", "/reset-password", "/verify-email"].includes(
          location.pathname,
        )
      )
        return;
      clearDrafts();
      client.clear();
      location.assign("/dashboard");
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("apiforge:clear-drafts", clearDrafts);
    window.addEventListener("apiforge:unauthorized", unauthorized);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("apiforge:clear-drafts", clearDrafts);
      window.removeEventListener("apiforge:unauthorized", unauthorized);
    };
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
