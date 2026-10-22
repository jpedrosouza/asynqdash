import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, Empty } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { Page } from "../components/common";

/** Shown when a page crashes while rendering, instead of a blank screen. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <Page>
      <Empty
        icon={<WarningOctagonIcon size={32} className="text-kumo-danger" />}
        title="This page ran into a problem"
        description={message}
        contents={
          <Button icon={ArrowClockwiseIcon} onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        }
      />
    </Page>
  );
}
