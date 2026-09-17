import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AccountPanel } from "./account-panel";

export default async function AccountPage() {
  await connection();
  if (process.env.ARCADE_SHARED_AUTH_ENABLED !== "true") notFound();
  return <AccountPanel />;
}
