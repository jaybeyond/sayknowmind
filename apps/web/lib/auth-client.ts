import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5400",
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
