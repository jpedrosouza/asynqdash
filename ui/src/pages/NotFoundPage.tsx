import { useNavigate } from "react-router";
import { Button, Empty } from "@cloudflare/kumo";
import { CompassIcon } from "@phosphor-icons/react";
import { paths } from "../lib/paths";
import { Page } from "../components/common";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Page>
      <Empty
        icon={<CompassIcon size={32} />}
        title="Page not found"
        description="The page you are looking for does not exist."
        contents={<Button onClick={() => navigate(paths.home)}>Go to queues</Button>}
      />
    </Page>
  );
}
