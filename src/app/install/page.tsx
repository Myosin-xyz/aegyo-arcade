"use client";

/**
 * INSTALL-1 (TECH_SPEC adopted default): user-invoked install help from
 * portal navigation — NO automatic prompt. Static per-platform steps;
 * client component so t() resolves the device locale.
 */

import Link from "next/link";
import { t } from "@/i18n/t";
import { AegyoLogo } from "../logo";

const SECTIONS = [
  { titleKey: "install.ios.title", steps: 3, prefix: "install.ios" },
  { titleKey: "install.android.title", steps: 3, prefix: "install.android" },
  { titleKey: "install.desktop.title", steps: 2, prefix: "install.desktop" },
];

export default function InstallHelp() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-12">
      <header className="flex flex-col items-center gap-2 pt-10 text-center">
        <AegyoLogo className="h-12 w-12" />
        <h1 className="font-arcade text-base font-bold uppercase text-brand">
          {t("install.title")}
        </h1>
        <p className="text-sm text-muted">{t("install.intro")}</p>
      </header>
      {SECTIONS.map((section) => (
        <section key={section.prefix} className="card-arcade p-4">
          <h2 className="mb-2 font-bold">{t(section.titleKey)}</h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted">
            {Array.from({ length: section.steps }, (_, i) => (
              <li key={i}>{t(`${section.prefix}.step${i + 1}`)}</li>
            ))}
          </ol>
        </section>
      ))}
      <Link
        href="/"
        className="btn-ghost mx-auto px-6 py-2.5 text-sm font-semibold"
      >
        {t("install.back")}
      </Link>
    </main>
  );
}
