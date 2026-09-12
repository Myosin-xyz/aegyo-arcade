import { notFound } from "next/navigation";
import { AccountPanel } from "./account-panel";

export default function AccountPage() {
  if (process.env.ARCADE_SHARED_AUTH_ENABLED !== "true") notFound();
  return <AccountPanel />;
}
