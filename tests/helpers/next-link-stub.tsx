/**
 * next/link stub for host-level tests: renders a plain anchor. The real
 * Link needs the Next runtime; the host tests only need the DOM shape.
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function LinkStub({
  href,
  children,
  prefetch: _prefetch,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  children: ReactNode;
}) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
