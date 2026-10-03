import BrowserSignOutClient from "./browser-sign-out-client";

const products = new Set(["aegyo", "arcade", "daebak"]);

export default async function BrowserSignOutPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>;
}) {
  const product = (await searchParams).return;
  return (
    <BrowserSignOutClient product={product && products.has(product) ? product : null} />
  );
}
