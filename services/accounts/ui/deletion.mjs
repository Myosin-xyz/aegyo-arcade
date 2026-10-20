import { readFileSync } from "node:fs";
export const deletionJs = readFileSync(
  new URL("./deletion.js", import.meta.url),
  "utf8",
);

export function renderDeletionPage(locale = "en", enabled = false) {
  const es = locale === "es";
  const t = (en, spanish) => (es ? spanish : en);
  return `<!doctype html><html lang="${es ? "es" : "en"}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex"><title>${t("Delete Aegyo account", "Eliminar cuenta Aegyo")}</title>
    <link rel="stylesheet" href="/assets/accounts.css"><script src="/deletion.js" defer></script></head>
    <body data-locale="${locale}" data-enabled="${enabled}"><main><section class="account-shell">
      <h1>${t("Delete your Aegyo account", "Eliminar tu cuenta Aegyo")}</h1>
      <p>${t(
        "This removes your shared login, profile and account-linked content from Arena, Arcade and Daebak. You will be signed out.",
        "Esto elimina tu acceso compartido, perfil y contenido vinculado a tu cuenta de Arena, Arcade y Daebak. Se cerrará tu sesión.",
      )}</p>
      <p>${t(
        "Your Daebak wallet and its user association remain. Blockchain history cannot be erased. Transaction records and a minimal deletion record are retained. Separate wallet-provider access is not deleted.",
        "Tu wallet de Daebak y su asociación contigo se conservan. El historial de blockchain no se puede borrar. Se conservan los registros de transacciones y un registro mínimo de eliminación. No se elimina el acceso independiente del proveedor de la wallet.",
      )}</p>
      <p>${t(
        "Deletion starts automatically after confirmation. If a service is unavailable, it retries until every product confirms completion. Keep this page to check progress. Older content without a reliable account link may require review; it will be listed in your receipt.",
        "La eliminación comienza automáticamente al confirmar. Si un servicio no está disponible, se reintenta hasta que todos confirmen. Conserva esta página para ver el progreso. El contenido antiguo sin vínculo fiable con tu cuenta puede requerir revisión; aparecerá en tu comprobante.",
      )}</p>
      <p>${t(
        "Anonymous device scores and history remain, including on this device. Backups expire under each product’s retention policy and are not instantly rewritten.",
        "Las puntuaciones y el historial anónimos de los dispositivos se conservan, incluidos los de este dispositivo. Las copias de seguridad caducan según la política de conservación de cada producto y no se reescriben inmediatamente.",
      )}</p>
      <p id="deletion-status" role="status" aria-live="polite"></p>
      <form class="account-form" id="deletion-form" ${enabled ? "" : "hidden"}>
        <label><input type="checkbox" name="confirm" required>
          ${t("I understand what is removed and retained. Delete my account.", "Entiendo qué se elimina y qué se conserva. Eliminar mi cuenta.")}</label>
        <button class="primary-action" type="submit">${t("Delete account", "Eliminar cuenta")}</button>
      </form>
      <a id="deletion-signin" href="/sign-in?continue=%2Fdelete-account${es ? "%3Flang%3Des&lang=es" : ""}" hidden>
        ${t("Sign in again to confirm deletion", "Inicia sesión de nuevo para confirmar la eliminación")}</a>
      <section id="deletion-receipt" hidden><h2>${t("Deletion receipt", "Comprobante de eliminación")}</h2><p id="deletion-manifest"></p></section>
      <p><a href="/account${es ? "?lang=es" : ""}">${t("Back to account", "Volver a tu cuenta")}</a></p>
    </section></main></body></html>`;
}
