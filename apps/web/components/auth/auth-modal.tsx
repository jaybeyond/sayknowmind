"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Kept for call-site compatibility. Sign-up now happens in SayKnowWork, so
  // the modal always shows the login form regardless of this.
  defaultMode?: "login" | "signup";
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex justify-center">
            <img src="/logo-text.svg" alt="SayknowMind" className="h-5 invert dark:invert-0" />
          </DialogTitle>
          <p className="text-center text-sm text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </DialogHeader>

        <div className="p-6 space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
            {t("auth.useSayKnowWorkAccount")}
          </div>
          <LoginForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const REMEMBER_ME_STORAGE_KEY = "sayknowmind.auth.rememberMe";
// We remember only the email address (non-sensitive) so the form can pre-fill it
// on the next visit. The PASSWORD is intentionally never stored by the app:
// anything kept client-side is recoverable client-side, so it would be security
// theater. The password field uses autoComplete="current-password", which lets
// the browser's / OS's password manager save and autofill it securely instead.
const SAVED_EMAIL_STORAGE_KEY = "sayknowmind.auth.savedEmail";
// Legacy key from an earlier build that stored the plaintext password — purge it
// on load so no old plaintext credential lingers in localStorage.
const LEGACY_CREDENTIALS_STORAGE_KEY = "sayknowmind.auth.savedCredentials";

function LoginForm() {
  const { t } = useTranslation();
  const savedEmail = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    window.localStorage.removeItem(LEGACY_CREDENTIALS_STORAGE_KEY);
    return window.localStorage.getItem(SAVED_EMAIL_STORAGE_KEY);
  }, []);
  const [email, setEmail] = React.useState(() => savedEmail ?? "");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // Single "keep me signed in" toggle. It does two things at once: keeps the
  // session cookie persistent (vs session-only when unchecked) AND pre-fills the
  // email on the next visit. Default on. The password is never stored by us —
  // the browser's password manager handles that via autoComplete.
  const [rememberMe, setRememberMe] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, rememberMe ? "1" : "0");
    // Tie email persistence to the same toggle.
    if (rememberMe && email) {
      window.localStorage.setItem(SAVED_EMAIL_STORAGE_KEY, email);
    } else if (!rememberMe) {
      window.localStorage.removeItem(SAVED_EMAIL_STORAGE_KEY);
    }
  }, [rememberMe, email]);

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
        body: JSON.stringify({ loginId: email, password, rememberMe }),
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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="modal-loginId" className="text-sm font-medium">
          {t("auth.loginId")}
        </label>
        <Input
          id="modal-loginId"
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.loginIdPlaceholder")}
          required
          autoComplete="username"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="modal-password" className="text-sm font-medium">
          {t("auth.password")}
        </label>
        <div className="relative">
          <Input
            id="modal-password"
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
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        <span>{t("auth.rememberMe")}</span>
      </label>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.login")}
      </Button>
    </form>
  );
}
