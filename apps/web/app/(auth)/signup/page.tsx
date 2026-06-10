import { redirect } from "next/navigation";

// Accounts are created and managed in SayKnowWork SaaS, not here. Anyone who
// has a SayKnowWork account simply logs in (their local profile is provisioned
// on first login), so there's no in-app sign-up form to show.
export default function SignupPage() {
  redirect("/login");
}
