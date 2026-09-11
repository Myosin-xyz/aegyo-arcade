import { createHash, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";

export const LEGACY_PREFIX = "aegyo-sha256-v1$";

/** Legacy verification only. A successful check does not persist a rehash. */
export function passwordFunctions(legacyPepper) {
  if (typeof legacyPepper !== "string" || legacyPepper.length === 0) {
    throw new Error("An explicit legacy pepper is required");
  }
  return {
    hash: hashPassword,
    async verify({ password, hash }) {
      if (typeof password !== "string" || typeof hash !== "string")
        return false;
      if (!hash.startsWith(LEGACY_PREFIX)) {
        try {
          return await verifyPassword({ password, hash });
        } catch {
          return false;
        }
      }
      const hex = hash.slice(LEGACY_PREFIX.length);
      if (!/^[a-f0-9]{64}$/.test(hex)) return false;
      const digest = createHash("sha256")
        .update(password + legacyPepper, "utf8")
        .digest();
      return timingSafeEqual(digest, Buffer.from(hex, "hex"));
    },
  };
}
