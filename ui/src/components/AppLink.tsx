import { forwardRef } from "react";
import { Link as RouterLink } from "react-router";
import type { LinkComponentProps } from "@cloudflare/kumo";

/**
 * Bridges Kumo links (Link, Breadcrumbs, Sidebar items) to React Router so that
 * internal navigation does not reload the page. External links render a plain anchor.
 */
export const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(function AppLink({ href, to, ...rest }, ref) {
  const target = href ?? to ?? "";
  if (/^(https?:)?\/\//.test(target) || target.startsWith("mailto:")) {
    return <a ref={ref} href={target} {...rest} />;
  }
  return <RouterLink ref={ref} to={target} {...rest} />;
});
