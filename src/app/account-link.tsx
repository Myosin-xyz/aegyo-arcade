"use client";

import Link from "next/link";
import { getLocale } from "@/i18n/t";

export function AccountLink({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <Link
      href="/account"
      prefetch={false}
      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-brand underline-offset-4 hover:underline"
    >
      {getLocale() === "es-419" ? "Mi cuenta" : "My account"}
    </Link>
  );
}
