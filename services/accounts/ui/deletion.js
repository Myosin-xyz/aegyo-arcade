(() => {
  const es = document.body.dataset.locale === "es";
  const t = (en, spanish) => (es ? spanish : en);
  const status = document.getElementById("deletion-status");
  const form = document.getElementById("deletion-form");
  const signIn = document.getElementById("deletion-signin");
  let polling = false;
  let timer;
  async function request(options, timeout) {
    // WKWebView on the supported older iOS versions lacks AbortSignal.timeout.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch("/api/account-deletion", {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(deadline);
    }
  }
  function receipt(data) {
    form.hidden = true;
    signIn.hidden = true;
    document.getElementById("deletion-receipt").hidden = false;
    document.getElementById("deletion-manifest").textContent =
      t("Receipt: ", "Comprobante: ") +
      data.requestId +
      ". " +
      t(
        "Wallet recovery, wallet association, transaction history and the deletion record are retained. Account-linked scores and ranking entries are removed once Arcade confirms completion.",
        "Se conservan la recuperación y asociación de la wallet, el historial de transacciones y el comprobante. Las puntuaciones y posiciones vinculadas a la cuenta se eliminan cuando Arcade confirma.",
      );
    const blocked = Object.values(data.manifest || {}).some(
      (product) => product.status === "blocked",
    );
    status.textContent = blocked
      ? t(
          "Your shared sign-in is disabled. Deletion needs a team review before it can finish; keep this receipt for follow-up.",
          "Tu acceso compartido está desactivado. El equipo debe revisar la eliminación antes de completarla; conserva este comprobante.",
        )
      : data.status === "completed"
        ? t(
            "Account deletion completed. The retained items are listed below.",
            "Eliminación completada. Los datos conservados figuran abajo.",
          )
        : data.status === "needs_review"
          ? t(
              "Your shared sign-in and confirmed account data have been removed. Some older records still require review; keep this receipt for follow-up.",
              "Tu acceso compartido y los datos confirmados se han eliminado. Algunos registros antiguos requieren revisión; conserva este comprobante.",
            )
          : t(
              "Your shared sign-in is disabled. Deletion is processing across all three products.",
              "Tu acceso compartido está desactivado. La eliminación está en proceso en los tres productos.",
            );
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "aegyo-account-deletion", status: data.status }),
    );
    if (data.status === "processing" && !blocked)
      timer = setTimeout(check, 5000);
  }
  async function check() {
    if (polling) return;
    polling = true;
    try {
      const response = await request({ cache: "no-store" }, 10000);
      if (response.ok) receipt(await response.json());
      else if (response.status !== 404) timer = setTimeout(check, 10000);
    } catch {
      timer = setTimeout(check, 10000);
    } finally {
      polling = false;
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const response = await request(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            policyVersion: "2026-10-20.1",
          }),
        },
        30000,
      );
      if (response.ok) {
        clearTimeout(timer);
        receipt(await response.json());
        return;
      }
      if (response.status === 401) {
        signIn.hidden = false;
        status.textContent = t(
          "Please sign in again before deleting your account.",
          "Inicia sesión de nuevo antes de eliminar tu cuenta.",
        );
      } else {
        status.textContent = t(
          "We could not confirm the request's status. Checking for a receipt before you try again.",
          "No pudimos confirmar el estado de la solicitud. Buscaremos un comprobante antes de que lo intentes de nuevo.",
        );
        void check();
      }
    } catch {
      status.textContent = t(
        "Checking whether your request was received…",
        "Comprobando si se recibió tu solicitud…",
      );
      void check();
    } finally {
      button.disabled = false;
    }
  });
  if (document.body.dataset.enabled !== "true") {
    status.textContent = t(
      "Account deletion is temporarily unavailable. Please try again later.",
      "La eliminación de cuentas no está disponible temporalmente. Inténtalo más tarde.",
    );
  }
  void check();
})();
