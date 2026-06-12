"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { isSaasAuth } from "@/lib/auth-mode";
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

    if (isSaasAuth) {
      // Enterprise: delegate credential check to SayKnowWork SaaS.
      try {
        const res = await fetch("/api/auth/external-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId, password }),
        });
        if (res.ok) {
          window.location.href = "/";
          return;
        }
        const data = await res.json().catch(() => ({}));
        setError(translateAuthError(data.code, data.message));
      } catch {
        setError(translateAuthError("SAAS_UNREACHABLE"));
      }
      setLoading(false);
      return;
    }

    // Open: built-in better-auth email/password login.
    const { error: authError } = await signIn.email(
      { email: loginId, password, callbackURL: "/" },
      {
        onError: (ctx) => setError(translateAuthError(ctx.error.code, ctx.error.message)),
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    );
    if (authError) setError(translateAuthError(authError.code, authError.message));
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

      {isSaasAuth && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
          {t("auth.useSayKnowWorkAccount")}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="loginId" className="text-sm font-medium">
            {isSaasAuth ? t("auth.loginId") : t("auth.email")}
          </label>
          <Input
            id="loginId"
            type={isSaasAuth ? "text" : "email"}
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder={isSaasAuth ? t("auth.loginIdPlaceholder") : "you@example.com"}
            required
            autoComplete={isSaasAuth ? "username" : "email"}
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

      {isSaasAuth ? (
        <p className="text-center text-sm text-muted-foreground">
          <a
            href="https://sayknowwork.ai-ops.click"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t("auth.forgotPasswordSayKnowWork")}
          </a>
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link href="/signup" className="text-primary hover:underline">
            {t("auth.signup")}
          </Link>
        </p>
      )}
    </div>
  );
}
