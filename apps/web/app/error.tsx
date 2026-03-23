"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="min-h-svh flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-auto p-6 space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold font-heading">{t("error.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("error.description")}
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              {t("error.idPrefix")}{error.digest}
            </p>
          )}
        </div>
        <Button onClick={reset} className="w-full">
          {t("error.retry")}
        </Button>
      </div>
    </div>
  );
}
