import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toasty, TooltipProvider } from "@cloudflare/kumo";
import "./app.css";
import { ROOT_PATH } from "./lib/flags";
import { queryClient } from "./lib/queries";
import { SettingsProvider } from "./lib/settings";
import { toastManager } from "./lib/toast";
import { AppShell } from "./components/AppShell";
import { LoadingState } from "./components/common";
import { DashboardPage } from "./pages/DashboardPage";
import { QueuePage } from "./pages/QueuePage";
import { TaskPage } from "./pages/TaskPage";
import { ServersPage } from "./pages/ServersPage";
import { SchedulersPage } from "./pages/SchedulersPage";
import { RedisPage } from "./pages/RedisPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RouteErrorPage } from "./pages/RouteErrorPage";

const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      errorElement: <RouteErrorPage />,
      children: [
        {
          // Errors thrown by a page are rendered inside the app shell, keeping navigation available.
          errorElement: <RouteErrorPage />,
          children: [
            { index: true, element: <DashboardPage /> },
            { path: "queues/:qname", element: <QueuePage /> },
            { path: "queues/:qname/tasks/:taskId", element: <TaskPage /> },
            { path: "servers", element: <ServersPage /> },
            { path: "schedulers", element: <SchedulersPage /> },
            { path: "redis", element: <RedisPage /> },
            // Loaded on demand: it bundles the time series charts.
            {
              path: "metrics",
              lazy: () => import("./pages/MetricsPage").then((m) => ({ Component: m.MetricsPage })),
              hydrateFallbackElement: <LoadingState />,
            },
            // Path used by previous versions of the UI.
            { path: "q/metrics", element: <Navigate to="/metrics" replace /> },
            { path: "settings", element: <SettingsPage /> },
            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: ROOT_PATH || "/" },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <Toasty toastManager={toastManager}>
          <TooltipProvider delay={300}>
            <RouterProvider router={router} />
          </TooltipProvider>
        </Toasty>
      </QueryClientProvider>
    </SettingsProvider>
  </StrictMode>,
);
