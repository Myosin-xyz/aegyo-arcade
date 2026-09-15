#!/usr/bin/env node
import net from "node:net";
const host = process.env.AEGYO_RELAY_TARGET_HOST ?? "";
if (!host.endsWith(".railway.internal")) {
  console.error("relay_target_refused");
  process.exit(2);
}
const port = Number(process.env.AEGYO_RELAY_TARGET_PORT ?? "5432");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error("relay_port_refused");
  process.exit(2);
}
const server = net.createServer((client) => {
  const upstream = net.connect({ host, port });
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
});
server.on("error", () => {
  console.error("relay_failed");
  process.exit(3);
});
server.listen(6543, "127.0.0.1", () =>
  console.info("loopback_tcp_relay_ready=true"),
);
