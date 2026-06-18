import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

// Send auth requests to the SAME origin the app is actually served from, so
// login works on every domain this deployment answers — the branded custom
// domain AND the Railway-default *.up.railway.app — without cross-origin CORS.
// Baking a single NEXT_PUBLIC_APP_URL here CORS-fails the moment the page is
// opened on a different host than the baked one (e.g. the .up.railway.app URL).
// The desktop build has no real http origin (it loads over tauri://…), so it
// falls back to the configured remote API URL.
function resolveAuthBaseURL(): string {
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5400";
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseURL(),
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
