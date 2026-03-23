"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-svh flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-auto p-6 space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold font-heading text-muted-foreground">404</h1>
          <h2 className="text-xl font-semibold">{t("notFound.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("notFound.description")}
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/">{t("notFound.goHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
