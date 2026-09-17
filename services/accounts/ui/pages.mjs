import { readFileSync } from "node:fs";

export const accountsCss = readFileSync(
  new URL("./accounts.css", import.meta.url),
  "utf8",
);
export const accountsJs = readFileSync(
  new URL("./accounts.js", import.meta.url),
  "utf8",
);

const copy = {
  en: {
    language: "Español",
    languageCode: "es",
    skip: "Skip to account form",
    brand: "Aegyo Arena",
    close: "Back to the arcade",
    secure: "One account for Aegyo Arena",
    signinTitle: "Welcome back",
    signinIntro: "Sign in to continue where you left off.",
    signupTitle: "Create your account",
    signupIntro: "Save your profile and take it across Aegyo Arena.",
    forgotTitle: "Reset your password",
    forgotIntro: "We’ll email you a secure link if an account matches.",
    resetTitle: "Choose a new password",
    resetIntro: "Use a password you haven’t used here before.",
    verifyTitle: "Verify your email",
    verifyIntro:
      "Confirming your email protects your account and unlocks member features.",
    accountTitle: "You’re signed in",
    accountIntro: "Your Aegyo Arena account is ready wherever you play.",
    name: "Display name",
    email: "Email address",
    password: "Password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signin: "Sign in",
    signup: "Create account",
    sendReset: "Send reset link",
    reset: "Save new password",
    resend: "Send verification email",
    verify: "Verify email",
    signout: "Sign out",
    forgot: "Forgot your password?",
    noAccount: "New to Aegyo Arena?",
    hasAccount: "Already have an account?",
    createOne: "Create one",
    goSignin: "Sign in",
    passwordHint: "At least 8 characters.",
    signedInAs: "Signed in as",
    verified: "Email verified",
    notVerified: "Email not verified",
    continue: "Continue",
    checkEmailTitle: "Check your inbox",
    checkEmail:
      "If an account matches that address, a reset link is on its way. Check spam if it doesn’t arrive soon.",
    verificationSent:
      "A new verification email is on its way. You can close this page after checking your inbox.",
    verifiedTitle: "Email verified",
    verifiedBody: "Your email is confirmed. You can continue to Aegyo Arena.",
    invalidLink:
      "This link is invalid or has already been used. Request a new one to continue.",
    expiredLink: "This link has expired. Request a new one to continue.",
    resetDone:
      "Your password has been updated. Sign in with your new password.",
    working: "One moment…",
    genericError: "We couldn’t complete that request. Try again.",
    credentialsError:
      "That email or password doesn’t match. Try again or reset your password.",
    emailExists: "An account already uses that email. Sign in instead.",
    passwordMismatch: "The passwords don’t match.",
    rateLimited: "Too many attempts. Wait a moment and try again.",
    networkError:
      "We couldn’t reach Aegyo Arena. Check your connection and try again.",
    sessionExpired: "Your session ended. Sign in again to continue.",
    registrationClosedTitle: "Registration opens soon",
    registrationClosed:
      "New accounts aren’t available yet. Existing members can still sign in or recover access.",
    emailUnavailableTitle: "Email delivery isn’t available",
    emailUnavailable:
      "Verification and password recovery emails aren’t available right now. Try again later.",
  },
  es: {
    language: "English",
    languageCode: "en",
    skip: "Ir al formulario de cuenta",
    brand: "Aegyo Arena",
    close: "Volver al arcade",
    secure: "Una cuenta para Aegyo Arena",
    signinTitle: "Qué bueno verte",
    signinIntro: "Inicia sesión para continuar donde quedaste.",
    signupTitle: "Crea tu cuenta",
    signupIntro: "Guarda tu perfil y úsalo en todo Aegyo Arena.",
    forgotTitle: "Restablece tu contraseña",
    forgotIntro: "Te enviaremos un enlace seguro si encontramos una cuenta.",
    resetTitle: "Elige una contraseña nueva",
    resetIntro: "Usa una contraseña que no hayas usado aquí antes.",
    verifyTitle: "Verifica tu correo",
    verifyIntro:
      "Confirmar tu correo protege tu cuenta y activa las funciones para miembros.",
    accountTitle: "Tu sesión está activa",
    accountIntro: "Tu cuenta de Aegyo Arena está lista donde sea que juegues.",
    name: "Nombre visible",
    email: "Correo electrónico",
    password: "Contraseña",
    newPassword: "Contraseña nueva",
    confirmPassword: "Confirma la contraseña",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    signin: "Iniciar sesión",
    signup: "Crear cuenta",
    sendReset: "Enviar enlace",
    reset: "Guardar contraseña",
    resend: "Enviar correo de verificación",
    verify: "Verificar correo",
    signout: "Cerrar sesión",
    forgot: "¿Olvidaste tu contraseña?",
    noAccount: "¿Primera vez en Aegyo Arena?",
    hasAccount: "¿Ya tienes una cuenta?",
    createOne: "Crear una",
    goSignin: "Iniciar sesión",
    passwordHint: "Mínimo 8 caracteres.",
    signedInAs: "Sesión iniciada como",
    verified: "Correo verificado",
    notVerified: "Correo sin verificar",
    continue: "Continuar",
    checkEmailTitle: "Revisa tu bandeja de entrada",
    checkEmail:
      "Si existe una cuenta con ese correo, el enlace ya va en camino. Revisa spam si tarda en llegar.",
    verificationSent:
      "Enviamos un nuevo correo de verificación. Puedes cerrar esta página después de revisar tu bandeja.",
    verifiedTitle: "Correo verificado",
    verifiedBody:
      "Tu correo está confirmado. Ya puedes continuar a Aegyo Arena.",
    invalidLink:
      "Este enlace no es válido o ya fue usado. Solicita uno nuevo para continuar.",
    expiredLink: "Este enlace venció. Solicita uno nuevo para continuar.",
    resetDone: "Actualizamos tu contraseña. Inicia sesión con la nueva.",
    working: "Un momento…",
    genericError: "No pudimos completar la solicitud. Intenta de nuevo.",
    credentialsError:
      "El correo o la contraseña no coinciden. Intenta de nuevo o restablece tu contraseña.",
    emailExists: "Ya existe una cuenta con ese correo. Inicia sesión.",
    passwordMismatch: "Las contraseñas no coinciden.",
    rateLimited: "Demasiados intentos. Espera un momento e intenta de nuevo.",
    networkError:
      "No pudimos conectar con Aegyo Arena. Revisa tu conexión e intenta de nuevo.",
    sessionExpired: "Tu sesión terminó. Inicia sesión de nuevo para continuar.",
    registrationClosedTitle: "Las inscripciones abrirán pronto",
    registrationClosed:
      "Las cuentas nuevas aún no están disponibles. Si ya eres miembro, puedes iniciar sesión o recuperar tu acceso.",
    emailUnavailableTitle: "El envío de correos no está disponible",
    emailUnavailable:
      "Los correos de verificación y recuperación no están disponibles ahora. Intenta más tarde.",
  },
};

const pageMeta = {
  "sign-in": ["signinTitle", "signinIntro"],
  "sign-up": ["signupTitle", "signupIntro"],
  "forgot-password": ["forgotTitle", "forgotIntro"],
  "reset-password": ["resetTitle", "resetIntro"],
  "verify-email": ["verifyTitle", "verifyIntro"],
  account: ["accountTitle", "accountIntro"],
};

const safeErrors = {
  INVALID_EMAIL_OR_PASSWORD: "credentialsError",
  INVALID_EMAIL: "credentialsError",
  USER_NOT_FOUND: "credentialsError",
  EMAIL_ALREADY_IN_USE: "emailExists",
  USER_ALREADY_EXISTS: "emailExists",
  TOO_MANY_REQUESTS: "rateLimited",
  RATE_LIMITED: "rateLimited",
  SESSION_EXPIRED: "sessionExpired",
  INVALID_TOKEN: "invalidLink",
  TOKEN_EXPIRED: "expiredLink",
};

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bunny() {
  return `<svg class="brand-mark" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20 47C21.5 36 25.5 24 30 18.5c2-3.1 8.5-3.1 10.5 0 2.5 4.3 5 14.5 6.3 23 .6 3 1.2 5.3 1.2 5.3s.6-2.3 1.2-5.3c1.3-8.5 3.8-18.7 6.3-23 2-3.1 8.5-3.1 10.5 0C70.5 24 74.5 36 76 47c1.3 8.5 2 18.5 1.4 24.5-.8 8.3-5.9 12.3-14.9 13.4-9.5 1.1-19.5 1.1-29 0-9-1.1-14.1-5.1-14.9-13.4C18 65.5 18.7 55.5 20 47Z" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M22.5 46.5h22m7 0h22" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="38" cy="64" r="5.5" stroke="currentColor" stroke-width="5"/><circle cx="58" cy="64" r="5.5" stroke="currentColor" stroke-width="5"/></svg>`;
}

function passwordField(c, id, label, autocomplete) {
  return `<div class="field"><label for="${id}">${label}</label><div class="password-control"><input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" minlength="8" required aria-describedby="${id}-hint"><button class="reveal" type="button" data-reveal="${id}" aria-label="${c.showPassword}">${c.showPassword}</button></div><p class="hint" id="${id}-hint">${c.passwordHint}</p></div>`;
}

function journeyHref(path, continuationUrl) {
  if (!continuationUrl) return path;
  return `${path}?continue=${encodeURIComponent(continuationUrl)}`;
}

function alertBlock(c, status, errorCode, page) {
  let kind = "",
    heading = "",
    body = "";
  if (status === "error") {
    kind = "error";
    body = c[safeErrors[errorCode] || "genericError"];
  } else if (status === "sent" && page === "forgot-password") {
    kind = "success";
    heading = c.checkEmailTitle;
    body = c.checkEmail;
  } else if (status === "sent" && page === "verify-email") {
    kind = "success";
    body = c.verificationSent;
  } else if (status === "success" && page === "verify-email") {
    kind = "success";
    heading = c.verifiedTitle;
    body = c.verifiedBody;
  } else if (status === "success" && page === "reset-password") {
    kind = "success";
    body = c.resetDone;
  } else if (status === "invalid") {
    kind = "error";
    body = c.invalidLink;
  } else if (status === "expired") {
    kind = "error";
    body = c.expiredLink;
  }
  return body
    ? `<div class="notice notice-${kind}" role="${kind === "error" ? "alert" : "status"}" tabindex="-1" data-notice>${heading ? `<strong>${heading}</strong>` : ""}<p>${body}</p></div>`
    : "";
}

function formFor(page, c, vm) {
  const email = esc(vm.email);
  const signInHref = esc(journeyHref("/sign-in", vm.continuationUrl));
  const signUpHref = esc(journeyHref("/sign-up", vm.continuationUrl));
  const forgotHref = esc(journeyHref("/forgot-password", vm.continuationUrl));
  const commonEmail = `<div class="field"><label for="email">${c.email}</label><input id="email" name="email" type="email" value="${email}" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required></div>`;
  const action = (name, label, inner, extra = "") =>
    `<form class="account-form" data-auth-form="${name}"${extra}><div class="form-error" role="alert" aria-live="assertive" hidden></div>${inner}<button class="primary-action" type="submit"><span>${label}</span><span class="button-progress" aria-hidden="true"></span></button></form>`;

  if (page === "sign-in")
    return `${action("sign-in", c.signin, `${commonEmail}${passwordField(c, "password", c.password, "current-password")}<div class="form-aside"><a href="${forgotHref}">${c.forgot}</a></div>`)}<p class="switcher">${c.noAccount} <a href="${signUpHref}">${c.createOne}</a></p>`;
  if (page === "sign-up") {
    if (!vm.signupAllowed)
      return `<div class="notice notice-success" role="status"><strong>${c.registrationClosedTitle}</strong><p>${c.registrationClosed}</p></div><a class="primary-action action-link" href="${signInHref}">${c.goSignin}</a><p class="switcher"><a href="${forgotHref}">${c.forgot}</a></p>`;
    return `${action("sign-up", c.signup, `<div class="field"><label for="name">${c.name}</label><input id="name" name="name" type="text" autocomplete="name" maxlength="80" required></div>${commonEmail}${passwordField(c, "password", c.password, "new-password")}`)}<p class="switcher">${c.hasAccount} <a href="${signInHref}">${c.goSignin}</a></p>`;
  }
  if (page === "forgot-password") {
    if (!vm.emailAvailable)
      return `<div class="notice notice-success" role="status"><strong>${c.emailUnavailableTitle}</strong><p>${c.emailUnavailable}</p></div><a class="primary-action action-link" href="${signInHref}">${c.goSignin}</a>`;
    return vm.status === "sent"
      ? `<a class="primary-action action-link" href="${signInHref}">${c.goSignin}</a>`
      : `${action("forgot-password", c.sendReset, commonEmail)}<p class="switcher"><a href="${signInHref}">${c.goSignin}</a></p>`;
  }
  if (page === "reset-password") {
    if (vm.status === "success")
      return `<a class="primary-action action-link" href="/sign-in">${c.goSignin}</a>`;
    if (!vm.token || vm.status === "invalid" || vm.status === "expired")
      return `<a class="primary-action action-link" href="/forgot-password">${c.sendReset}</a>`;
    return action(
      "reset-password",
      c.reset,
      `${passwordField(c, "newPassword", c.newPassword, "new-password")}${passwordField(c, "confirmPassword", c.confirmPassword, "new-password")}<input type="hidden" name="token" value="${esc(vm.token)}">`,
    );
  }
  if (page === "verify-email") {
    if (vm.status === "success")
      return vm.continuationUrl
        ? `<a class="primary-action action-link" href="${esc(vm.continuationUrl)}">${c.continue}</a>`
        : `<a class="primary-action action-link" href="/account">${c.continue}</a>`;
    if (vm.token && !["invalid", "expired"].includes(vm.status))
      return `<form data-auth-form="verify-email" data-auto-submit><input type="hidden" name="token" value="${esc(vm.token)}"><div class="verifying" role="status"><span class="spinner" aria-hidden="true"></span>${c.working}</div></form>`;
    if (!vm.emailAvailable)
      return `<div class="notice notice-success" role="status"><strong>${c.emailUnavailableTitle}</strong><p>${c.emailUnavailable}</p></div><a class="primary-action action-link" href="/sign-in">${c.goSignin}</a>`;
    return action("send-verification", c.resend, commonEmail);
  }
  const user = vm.user || {};
  const verificationLink = user.emailVerified
    ? ""
    : `<a class="primary-action action-link" href="${esc(journeyHref("/verify-email", vm.continuationUrl))}">${c.verify}</a>`;
  return `<div class="identity"><span class="avatar" aria-hidden="true">${esc((user.name || user.email || "A").trim().charAt(0).toUpperCase())}</span><div><span>${c.signedInAs}</span><strong>${esc(user.name || user.email || "")}</strong>${user.name && user.email ? `<small>${esc(user.email)}</small>` : ""}</div></div><div class="verification-state ${user.emailVerified ? "is-verified" : ""}"><span aria-hidden="true">${user.emailVerified ? "✓" : "!"}</span>${user.emailVerified ? c.verified : c.notVerified}</div>${verificationLink}${vm.continuationUrl ? `<a class="primary-action action-link" href="${esc(vm.continuationUrl)}">${c.continue}</a>` : ""}${action("sign-out", c.signout, "")}`;
}

export function renderAccountPage({
  page,
  locale = "en",
  status = "idle",
  errorCode = null,
  email = "",
  token = "",
  continuationUrl = "",
  oauthQuery = "",
  trustedRedirectUri = "",
  signupAllowed = false,
  emailAvailable = true,
  user = null,
} = {}) {
  if (!pageMeta[page]) throw new TypeError(`Unknown account page: ${page}`);
  const lang = locale === "es" ? "es" : "en";
  const c = copy[lang];
  const [titleKey, introKey] = pageMeta[page];
  const vm = {
    status,
    errorCode,
    email,
    token,
    continuationUrl,
    oauthQuery,
    trustedRedirectUri,
    signupAllowed,
    emailAvailable,
    user,
  };
  const alternateParams = new URLSearchParams({ lang: c.languageCode });
  if (continuationUrl) alternateParams.set("continue", continuationUrl);
  if (token && (page === "reset-password" || page === "verify-email"))
    alternateParams.set("token", token);
  const alternateUrl = `?${esc(alternateParams.toString())}`;
  const safeContinuation = esc(continuationUrl);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#140a26"><title>${esc(c[titleKey])} · ${c.brand}</title><link rel="stylesheet" href="/assets/accounts.css"><script src="/assets/accounts.js" defer></script></head>
<body data-page="${page}" data-status="${esc(status)}" data-continuation="${safeContinuation}" data-oauth-query="${esc(oauthQuery)}" data-trusted-redirect-uri="${esc(trustedRedirectUri)}" data-working="${esc(c.working)}" data-error-generic="${esc(c.genericError)}" data-error-network="${esc(c.networkError)}" data-error-credentials="${esc(c.credentialsError)}" data-error-email-exists="${esc(c.emailExists)}" data-error-rate="${esc(c.rateLimited)}" data-error-mismatch="${esc(c.passwordMismatch)}">
<a class="skip-link" href="#account-form">${c.skip}</a><div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
<header class="site-header"><a class="brand" href="/" aria-label="${c.brand}">${bunny()}<span>${c.brand}</span></a><nav aria-label="${lang === "es" ? "Opciones" : "Options"}"><a href="${alternateUrl}" hreflang="${c.languageCode}">${c.language}</a><a href="https://aegyoarena.com">${c.close}</a></nav></header>
<main><section class="account-shell" id="account-form" aria-labelledby="page-title"><div class="title-lockup"><span class="signal" aria-hidden="true"><i></i><i></i><i></i></span><p>${c.secure}</p></div><h1 id="page-title">${c[titleKey]}</h1><p class="intro">${c[introKey]}</p>${alertBlock(c, status, errorCode, page)}${formFor(page, c, vm)}</section></main>
<footer><span>${c.brand}</span><span aria-hidden="true">●</span><span>${lang === "es" ? "Juega. Vuelve. Comparte." : "Play. Return. Share."}</span></footer></body></html>`;
}
