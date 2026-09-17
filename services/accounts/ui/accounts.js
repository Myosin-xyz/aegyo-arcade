(() => {
  const body = document.body;
  const continuation = body.dataset.continuation || "";
  const oauthQuery = body.dataset.oauthQuery || "";
  const trustedRedirectUri = body.dataset.trustedRedirectUri || "";
  const endpointByAction = {
    "sign-in": "/api/auth/sign-in/email",
    "sign-up": "/api/auth/sign-up/email",
    "forgot-password": "/api/auth/request-password-reset",
    "reset-password": "/api/auth/reset-password",
    "send-verification": "/api/auth/send-verification-email",
    "verify-email": "/api/auth/verify-email",
    "sign-out": "/api/auth/sign-out",
  };

  function safeDestination(value, fallback) {
    if (!value) return fallback;
    try {
      const url = new URL(value, location.origin);
      if (url.origin === location.origin) return url.href;
    } catch {}
    return fallback;
  }

  function providerDestination(value) {
    if (!value) return "";
    try {
      const target = new URL(value, location.origin);
      if (target.origin === location.origin) {
        if (oauthQuery && target.pathname === "/api/auth/oauth2/authorize")
          return "";
        return target.href;
      }
      if (!trustedRedirectUri || target.protocol !== "https:") return "";
      const registered = new URL(trustedRedirectUri);
      if (
        registered.protocol !== "https:" ||
        target.origin !== registered.origin ||
        target.pathname !== registered.pathname
      )
        return "";
      if (!target.searchParams.has("code") || !target.searchParams.has("state"))
        return "";
      return target.href;
    } catch {
      return "";
    }
  }

  function postAuthDestination(providerUrl) {
    const providerRedirect = providerDestination(providerUrl);
    const ordinaryContinuation = oauthQuery
      ? ""
      : safeDestination(continuation, "");
    return providerRedirect || ordinaryContinuation || "/account";
  }

  function errorMessage(response, payload, action) {
    if (response.status === 429) return body.dataset.errorRate;
    const code = payload?.code || payload?.error?.code || "";
    if (/INVALID|CREDENTIAL|USER_NOT_FOUND/i.test(code) && action === "sign-in")
      return body.dataset.errorCredentials;
    if (/ALREADY|EXISTS/i.test(code) && action === "sign-up")
      return body.dataset.errorEmailExists;
    return body.dataset.errorGeneric;
  }

  async function submit(form) {
    const action = form.dataset.authForm;
    const endpoint = endpointByAction[action];
    if (!endpoint || form.dataset.busy === "true") return;
    const data = Object.fromEntries(new FormData(form));
    const error = form.querySelector(".form-error");
    if (
      action === "reset-password" &&
      data.newPassword !== data.confirmPassword
    ) {
      error.textContent = body.dataset.errorMismatch;
      error.hidden = false;
      form.querySelector("#confirmPassword")?.focus();
      return;
    }
    delete data.confirmPassword;
    if (action === "sign-in" || action === "sign-up")
      data.callbackURL = continuation || `${location.origin}/account`;
    if ((action === "sign-in" || action === "sign-up") && oauthQuery)
      data.oauth_query = oauthQuery;
    if (action === "forgot-password") {
      const reset = new URL("/reset-password", location.origin);
      if (continuation) reset.searchParams.set("continue", continuation);
      data.redirectTo = reset.href;
    }
    if (action === "send-verification" && continuation)
      data.callbackURL = continuation;
    form.dataset.busy = "true";
    form.setAttribute("aria-busy", "true");
    const button = form.querySelector("button[type=submit]");
    const buttonLabel = button?.querySelector("span");
    const originalLabel = buttonLabel?.textContent || "";
    if (button) {
      button.disabled = true;
      buttonLabel?.replaceChildren(body.dataset.working);
    }
    if (error) error.hidden = true;
    try {
      if (action === "verify-email") {
        const query = new URLSearchParams({ token: data.token });
        if (continuation) query.set("callbackURL", continuation);
        const response = await fetch(`${endpoint}?${query}`, {
          credentials: "same-origin",
          redirect: "manual",
        });
        if (!response.ok && response.type !== "opaqueredirect")
          throw Object.assign(new Error(), { response });
        location.assign(
          safeDestination(continuation, "/verify-email?status=success"),
        );
        return;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(data),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(), { response, payload });
      if (action === "forgot-password")
        location.assign(
          `/forgot-password?status=sent${data.email ? `&email=${encodeURIComponent(data.email)}` : ""}`,
        );
      else if (action === "send-verification")
        location.assign(
          `/verify-email?status=sent${data.email ? `&email=${encodeURIComponent(data.email)}` : ""}`,
        );
      else if (action === "reset-password")
        location.assign("/reset-password?status=success");
      else if (action === "sign-out") location.assign("/sign-in");
      else {
        location.assign(postAuthDestination(payload.url));
      }
    } catch (failure) {
      const message = failure.response
        ? errorMessage(failure.response, failure.payload, action)
        : body.dataset.errorNetwork;
      if (error) {
        error.textContent = message;
        error.hidden = false;
        error.focus?.();
      } else location.assign(`/${body.dataset.page}?status=error`);
    } finally {
      form.dataset.busy = "false";
      form.removeAttribute("aria-busy");
      if (button) {
        button.disabled = false;
        buttonLabel?.replaceChildren(originalLabel);
      }
    }
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-reveal]");
    if (!control) return;
    const input = document.getElementById(control.dataset.reveal);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    control.textContent = reveal
      ? document.documentElement.lang === "es"
        ? "Ocultar contraseña"
        : "Hide password"
      : document.documentElement.lang === "es"
        ? "Mostrar contraseña"
        : "Show password";
    control.setAttribute("aria-pressed", String(reveal));
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-auth-form]");
    if (!form) return;
    event.preventDefault();
    submit(form);
  });
  document.querySelector("[data-notice]")?.focus({ preventScroll: true });
  const auto = document.querySelector("[data-auto-submit]");
  if (auto) submit(auto);
  if (body.dataset.testHooks === "true")
    globalThis.__accountsNavigation = {
      safeDestination,
      providerDestination,
      postAuthDestination,
    };
})();
