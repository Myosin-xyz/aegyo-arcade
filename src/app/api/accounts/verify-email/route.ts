import { NextResponse } from "next/server";
import { getAccountsConfig } from "@/accounts/config";

export async function GET(): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  return NextResponse.redirect(
    new URL("/verify-email", config.providerBaseUrl),
  );
}
