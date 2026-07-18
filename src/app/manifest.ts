import type { MetadataRoute } from "next";

/** PWA manifest (TECH_SPEC: installable portal; INSTALL-1 keeps the
 * prompt user-invoked — this only declares identity + icons). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aegyo Arcade",
    short_name: "Aegyo",
    description:
      "K-pop mini-games: play daily, keep your streak, top the boards.",
    start_url: "/",
    display: "standalone",
    background_color: "#140a26",
    theme_color: "#140a26",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
