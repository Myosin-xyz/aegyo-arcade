"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getLocale } from "@/i18n/t";
import { AegyoLogo } from "../logo";
import styles from "./account.module.css";

type Profile = {
  username: string | null;
  emailVerified: boolean;
  usernameEditable: boolean;
};
type View =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "ready"; profile: Profile };

const copy = {
  en: {
    title: "Your player account",
    eyebrow: "Aegyo Arena",
    loading: "Loading your account…",
    unavailable: "We couldn’t load your account right now.",
    retry: "Try again",
    signedOut:
      "Sign in to choose a competition username and view your account.",
    signIn: "Sign in",
    home: "Back to games",
    verified: "Email verified",
    unverified: "Verify your email before choosing a competition username.",
    username: "Competition username",
    usernameHelp:
      "Use 3–20 lowercase letters, numbers, or underscores. You can choose it once.",
    placeholder: "your_username",
    save: "Choose username",
    saving: "Saving…",
    chosen: "Your username is set and cannot be changed.",
    optional: "A username is optional. You can keep playing without one.",
    collision: "That username is already taken.",
    reserved: "That username isn’t available.",
    invalid: "Use 3–20 lowercase letters, numbers, or underscores.",
    saveUnknown:
      "We couldn’t confirm the username. Check your account before trying again.",
    signOut: "Sign out of this arcade",
  },
  "es-419": {
    title: "Tu cuenta de jugador",
    eyebrow: "Aegyo Arena",
    loading: "Cargando tu cuenta…",
    unavailable: "No pudimos cargar tu cuenta en este momento.",
    retry: "Intentar de nuevo",
    signedOut:
      "Inicia sesión para elegir un nombre de competencia y ver tu cuenta.",
    signIn: "Iniciar sesión",
    home: "Volver a los juegos",
    verified: "Correo verificado",
    unverified: "Verifica tu correo antes de elegir un nombre de competencia.",
    username: "Nombre de competencia",
    usernameHelp:
      "Usa de 3 a 20 letras minúsculas, números o guiones bajos. Solo puedes elegirlo una vez.",
    placeholder: "tu_nombre",
    save: "Elegir nombre",
    saving: "Guardando…",
    chosen: "Tu nombre ya está definido y no se puede cambiar.",
    optional: "El nombre es opcional. Puedes seguir jugando sin elegir uno.",
    collision: "Ese nombre ya está en uso.",
    reserved: "Ese nombre no está disponible.",
    invalid: "Usa de 3 a 20 letras minúsculas, números o guiones bajos.",
    saveUnknown:
      "No pudimos confirmar el nombre. Revisa tu cuenta antes de intentar de nuevo.",
    signOut: "Cerrar sesión en este arcade",
  },
} as const;

export function AccountPanel() {
  const router = useRouter();
  const text = copy[getLocale()];
  const [view, setView] = useState<View>({ kind: "loading" });
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadProfile(): Promise<View> {
    try {
      const response = await fetch("/api/accounts/profile", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) return { kind: "signed-out" };
      if (!response.ok) return { kind: "unavailable" };
      const body = (await response.json()) as Partial<Profile>;
      if (
        (body.username !== null && typeof body.username !== "string") ||
        typeof body.emailVerified !== "boolean" ||
        typeof body.usernameEditable !== "boolean"
      )
        return { kind: "unavailable" };
      return { kind: "ready", profile: body as Profile };
    } catch {
      return { kind: "unavailable" };
    }
  }

  useEffect(() => {
    let current = true;
    void loadProfile().then((next) => {
      if (current) setView(next);
    });
    return () => {
      current = false;
    };
  }, []);

  async function inspect() {
    setView(await loadProfile());
  }

  async function chooseUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/accounts/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = (await response.json()) as Partial<Profile> & {
        code?: string;
      };
      if (
        response.ok &&
        body.username === username &&
        body.usernameEditable === false
      ) {
        setView({ kind: "ready", profile: body as Profile });
        return;
      }
      setMessage(
        body.code === "username_unavailable"
          ? text.collision
          : body.code === "invalid_username"
            ? text.invalid
            : body.code === "username_reserved"
              ? text.reserved
              : text.saveUnknown,
      );
    } catch {
      setMessage(text.saveUnknown);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/accounts/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <AegyoLogo className={styles.logo} />
        <p className={styles.eyebrow}>{text.eyebrow}</p>
        <h1>{text.title}</h1>
      </header>

      <section className={styles.card} aria-live="polite">
        {view.kind === "loading" && (
          <p className={styles.status}>{text.loading}</p>
        )}
        {view.kind === "unavailable" && (
          <div className={styles.centered}>
            <p>{text.unavailable}</p>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => void inspect()}
            >
              {text.retry}
            </button>
          </div>
        )}
        {view.kind === "signed-out" && (
          <div className={styles.centered}>
            <p>{text.signedOut}</p>
            <Link
              className="btn-arcade"
              href="/api/accounts/login"
              prefetch={false}
            >
              {text.signIn}
            </Link>
          </div>
        )}
        {view.kind === "ready" && (
          <div className={styles.account}>
            <div
              className={styles.verification}
              data-verified={view.profile.emailVerified}
            >
              <span aria-hidden>{view.profile.emailVerified ? "✓" : "!"}</span>
              {view.profile.emailVerified ? text.verified : text.unverified}
            </div>
            <div>
              <h2>{text.username}</h2>
              {view.profile.username ? (
                <>
                  <p className={styles.username}>@{view.profile.username}</p>
                  <p className={styles.help}>{text.chosen}</p>
                </>
              ) : view.profile.usernameEditable ? (
                <form className={styles.form} onSubmit={chooseUsername}>
                  <label htmlFor="competition-username">
                    {text.usernameHelp}
                  </label>
                  <div className={styles.inputRow}>
                    <span aria-hidden>@</span>
                    <input
                      id="competition-username"
                      name="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={text.placeholder}
                      pattern="[a-z0-9_]{3,20}"
                      minLength={3}
                      maxLength={20}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                    />
                  </div>
                  {message && <p className={styles.error}>{message}</p>}
                  <button
                    className="btn-arcade"
                    disabled={saving}
                    type="submit"
                  >
                    {saving ? text.saving : text.save}
                  </button>
                </form>
              ) : null}
              <p className={styles.optional}>{text.optional}</p>
            </div>
            <button
              className={styles.signOut}
              type="button"
              onClick={() => void signOut()}
            >
              {text.signOut}
            </button>
          </div>
        )}
      </section>
      <Link className={styles.home} href="/">
        ← {text.home}
      </Link>
    </main>
  );
}
