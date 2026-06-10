"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const { t } = useTranslation();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function translateAuthError(code?: string, fallback?: string): string {
    if (code) {
      const key = `auth.errors.${code}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    return fallback ?? t("auth.errors.UNKNOWN");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/external-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      if (res.ok) {
        // Full reload so middleware + server components pick up the new session.
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(translateAuthError(data.code, data.message));
    } catch {
      setError(translateAuthError("SAAS_UNREACHABLE"));
    }
    setLoading(false);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold font-heading text-primary">
          {t("app.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("app.subtitle")}
        </p>
      </div>

      <div className="rounded-md bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
        {t("auth.useSayKnowWorkAccount")}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="loginId" className="text-sm font-medium">
            {t("auth.loginId")}
          </label>
          <Input
            id="loginId"
            type="text"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder={t("auth.loginIdPlaceholder")}
            required
            autoComplete="username"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t("auth.password")}
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("common.loading") : t("auth.login")}
        </Button>
      </form>
    </div>
  );
}
