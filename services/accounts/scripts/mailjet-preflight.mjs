import "./check-runtime.mjs";
import {
  inspectMailjetSender,
  readMailjetPreflightConfig,
} from "../src/mailjet-preflight.mjs";

// Only source selection belongs in argv; credentials come from the environment.
const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== "--source" ||
  !["aegyo", "accounts"].includes(args[1])
) {
  console.error("Usage: npm run mail:preflight -- --source aegyo|accounts");
  process.exitCode = 2;
} else {
  try {
    const config = readMailjetPreflightConfig(process.env, args[1]);
    const report = await inspectMailjetSender(config);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.readyForDeliveryTest ? 0 : 2;
  } catch {
    console.log(
      JSON.stringify({ configured: false, reason: "check_mail_configuration" }),
    );
    process.exitCode = 2;
  }
}
