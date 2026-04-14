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
import { signIn, signUp } from "@/lib/auth-client";
import { useTranslation } from "@/lib/i18n";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultMode?: "login" | "signup";
}

export function AuthModal({
  open,
  onOpenChange,
  defaultMode = "login",
}: AuthModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<"login" | "signup">(defaultMode);

  // Reset mode when opened
  React.useEffect(() => {
    if (open) setMode(defaultMode);
  }, [open, defaultMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex flex-col items-center gap-3">
            <img src="/logo-icon.svg" alt="SayknowMind" className="size-12 rounded-xl" />
            <img src="/logo-text.svg" alt="SayknowMind" className="h-4 invert dark:invert-0" />
          </DialogTitle>
          <p className="text-center text-sm text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </DialogHeader>

        {/* Tab toggle */}
        <div className="flex border-b mx-6 mt-4">
          <button
            className={`flex-1 pb-2 text-sm font-medium transition-colors ${
              mode === "login"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("login")}
          >
            {t("auth.login")}
          </button>
          <button
            className={`flex-1 pb-2 text-sm font-medium transition-colors ${
              mode === "signup"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("signup")}
          >
            {t("auth.signup")}
          </button>
        </div>

        <div className="p-6">
          {mode === "login" ? <LoginForm /> : <SignupForm />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoginForm() {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

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

    const { error: authError } = await signIn.email(
      { email, password, callbackURL: "/" },
      {
        onError: (ctx) => {
          setError(translateAuthError(ctx.error.code, ctx.error.message));
        },
        onSuccess: () => {
          window.location.reload();
        },
      },
    );

    if (authError) {
      setError(translateAuthError(authError.code, authError.message));
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
        <label htmlFor="modal-email" className="text-sm font-medium">
          {t("auth.email")}
        </label>
        <Input
          id="modal-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.login")}
      </Button>
    </form>
  );
}

function SignupForm() {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

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

    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);

    const { error: authError } = await signUp.email(
      { name, email, password, callbackURL: "/" },
      {
        onError: (ctx) => {
          setError(translateAuthError(ctx.error.code, ctx.error.message));
        },
        onSuccess: () => {
          window.location.reload();
        },
      },
    );

    if (authError) {
      setError(translateAuthError(authError.code, authError.message));
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
        <label htmlFor="modal-name" className="text-sm font-medium">
          {t("auth.name")}
        </label>
        <Input
          id="modal-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="modal-signup-email" className="text-sm font-medium">
          {t("auth.email")}
        </label>
        <Input
          id="modal-signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="modal-signup-password" className="text-sm font-medium">
          {t("auth.password")}
        </label>
        <div className="relative">
          <Input
            id="modal-signup-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
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
      <div className="space-y-2">
        <label htmlFor="modal-confirm-password" className="text-sm font-medium">
          {t("auth.confirmPassword")}
        </label>
        <div className="relative">
          <Input
            id="modal-confirm-password"
            type={showConfirmPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showConfirmPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.signup")}
      </Button>
    </form>
  );
}
