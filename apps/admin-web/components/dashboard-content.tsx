import { redirect } from "next/navigation";
import { getDashboard } from "../src/dashboard/server-dashboard";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { Dashboard, DashboardError } from "./dashboard";

export async function DashboardContent() {
  const result = await getDashboard();
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind !== "ready")
    return <DashboardError forbidden={result.kind === "forbidden"} />;
  return <Dashboard data={result.data} />;
}
