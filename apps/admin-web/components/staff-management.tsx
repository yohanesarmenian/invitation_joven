"use client";
import { ActionFeedback, type FeedbackTone } from "./action-feedback";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminStaffListResponse,
  AdminStaffProvisionResponse,
} from "@wedding-invitation/api-client/src/index";
import * as api from "../src/staff/client";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";

type Action = {
  id: string;
  email: string;
  kind: "reset" | "disable" | "activate";
};
export function StaffManagement({ csrfToken }: { csrfToken: string }) {
  const router = useRouter(),
    lock = useRef(false);
  const [staffRole, setStaffRole] = useState<"GUEST_MANAGER" | "CHECKIN_STAFF">(
    "GUEST_MANAGER",
  );
  const [tone, setTone] = useState<FeedbackTone>("info");
  const [csrf, setCsrf] = useState(csrfToken),
    [data, setData] = useState<AdminStaffListResponse | null>(null),
    [page, setPage] = useState(1),
    [status, setStatus] = useState<"" | "ACTIVE" | "DISABLED">(""),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [action, setAction] = useState<Action | null>(null),
    [credential, setCredential] = useState<AdminStaffProvisionResponse | null>(
      null,
    ),
    [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const hide = () => setCredential(null);
    window.addEventListener("pagehide", hide);
    window.addEventListener("admin:signout", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("admin:signout", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void api.listStaff(page, status || undefined).then((result) => {
      if (!live) return;
      setLoading(false);
      if (result.kind === "ok") setData(result.data);
      else if (result.kind === "error" && result.code === "UNAUTHENTICATED")
        router.replace(SESSION_ENDED_PATH);
      else {
        setData(null);
        setTone("error");
        setMessage(
          "Unable to load staff. Check access and connection, then refresh explicitly.",
        );
      }
    });
    return () => {
      live = false;
    };
  }, [page, status, reload, router]);
  function refresh() {
    setLoading(true);
    setCredential(null);
    setReload((n) => n + 1);
  }
  async function perform(create = false) {
    if (lock.current || uncertain) return;
    lock.current = true;
    setPending(true);
    setTone("info");
    setMessage("");
    setCredential(null);
    const result = create
      ? await api.createStaff(email.trim().toLowerCase(), csrf, staffRole)
      : action?.kind === "reset"
        ? await api.resetStaff(action.id, csrf)
        : action
          ? await api.changeStaffStatus(
              action.id,
              action.kind === "disable" ? "DISABLED" : "ACTIVE",
              csrf,
            )
          : null;
    lock.current = false;
    setPending(false);
    if (!result) return;
    if (result.kind === "ok") {
      setTone("success");
      if ("temporaryPassword" in result.data) setCredential(result.data);
      setEmail("");
      setAction(null);
      setReload((n) => n + 1);
      setMessage(
        create
          ? "Staff created. Their first sign-in requires a password change."
          : action?.kind === "activate"
            ? "Staff activated."
            : "Staff updated. Affected sessions have been revoked.",
      );
    } else if (result.kind === "uncertain") {
      setTone("warning");
      setUncertain(true);
      setMessage(
        "The update outcome is unknown. It was not retried. Refresh the staff list to inspect account state. A lost temporary password cannot be recovered; after reviewing, an explicit password reset issues a new one and revokes earlier sessions.",
      );
    } else {
      setTone("error");
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (result.code === "UNAUTHENTICATED") {
        setCredential(null);
        router.replace(SESSION_ENDED_PATH);
        return;
      }
      setMessage(
        result.code === "CONFLICT"
          ? "The request conflicts with the account state. Refresh and review the staff email/status."
          : result.code === "FORBIDDEN"
            ? "Only the OWNER can manage staff."
            : result.code === "CSRF_INVALID"
              ? "Session verification failed. No action was replayed; try again explicitly."
              : "The request was rejected. Review the email and account state.",
      );
    }
  }
  return (
    <div className="checkin-workspace">
      <p>
        Individual Guest Manager accounts handle reception. Legacy CHECKIN_STAFF
        accounts remain available. Disabling an account or resetting its
        password revokes its sessions.
      </p>
      <ActionFeedback tone={tone}>{message}</ActionFeedback>
      {credential && (
        <section className="import-panel" aria-label="Temporary credential">
          <h2>Temporary password — shown once</h2>
          <p>{credential.staff.email}</p>
          <code>{credential.temporaryPassword}</code>
          <p>
            Pass it privately to this staff member. It disappears when
            dismissed, refreshed, or the page is hidden.
          </p>
          <button onClick={() => setCredential(null)}>
            Dismiss temporary password
          </button>
        </section>
      )}
      {uncertain && (
        <button
          onClick={() => {
            setUncertain(false);
            setAction(null);
            refresh();
          }}
        >
          Review current staff state
        </button>
      )}
      <section className="import-panel">
        <h2>Create staff</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(true);
          }}
        >
          <label htmlFor="staff-email">Staff email</label>
          <input
            id="staff-email"
            type="email"
            maxLength={254}
            required
            autoComplete="off"
            value={email}
            disabled={pending || uncertain}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button disabled={pending || uncertain || loading}>
            Create staff account
          </button>
          <label>
            Reception role
            <select
              aria-label="Reception role"
              value={staffRole}
              disabled={pending || uncertain}
              onChange={(event) =>
                setStaffRole(event.target.value as typeof staffRole)
              }
            >
              <option value="GUEST_MANAGER">Guest Manager — recommended</option>
              <option value="CHECKIN_STAFF">Check-in staff — legacy</option>
            </select>
          </label>
        </form>
      </section>
      <section className="import-panel">
        <h2>Staff accounts</h2>
        <label>
          Status
          <select
            value={status}
            disabled={pending}
            onChange={(e) => {
              setCredential(null);
              setData(null);
              setLoading(true);
              setPage(1);
              setStatus(e.target.value as typeof status);
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
        <button disabled={pending} onClick={refresh}>
          Refresh staff
        </button>
        {loading ? (
          <p>Loading staff…</p>
        ) : !data ? (
          <p>Staff list unavailable.</p>
        ) : (
          <>
            {data.items.length === 0 ? (
              <p>No staff accounts.</p>
            ) : (
              <ul>
                {data.items.map((staff) => (
                  <li key={staff.id}>
                    <h3>{staff.email}</h3>
                    <p>
                      {staff.role === "GUEST_MANAGER"
                        ? "Guest Manager"
                        : "Check-in staff (legacy)"}
                    </p>
                    <p>
                      {staff.status} ·{" "}
                      {staff.mustChangePassword
                        ? "Password change required"
                        : "Password set"}
                    </p>
                    <p>
                      Created: {staff.createdAt} · Last sign-in:{" "}
                      {staff.lastLoginAt ?? "Never"}
                    </p>
                    <button
                      disabled={pending || uncertain}
                      onClick={() => {
                        setCredential(null);
                        setAction({
                          id: staff.id,
                          email: staff.email,
                          kind:
                            staff.status === "ACTIVE" ? "disable" : "activate",
                        });
                      }}
                    >
                      {staff.status === "ACTIVE" ? "Disable" : "Activate"}{" "}
                      {staff.email}
                    </button>
                    <button
                      disabled={pending || uncertain}
                      onClick={() => {
                        setCredential(null);
                        setAction({
                          id: staff.id,
                          email: staff.email,
                          kind: "reset",
                        });
                      }}
                    >
                      Reset password for {staff.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p>
              Page {data.page.number} of {Math.max(1, data.page.totalPages)} ·{" "}
              {data.page.totalItems} accounts
            </p>
            <button
              disabled={pending || page <= 1}
              onClick={() => {
                setLoading(true);
                setCredential(null);
                setPage((n) => n - 1);
              }}
            >
              Previous page
            </button>
            <button
              disabled={pending || page >= data.page.totalPages}
              onClick={() => {
                setLoading(true);
                setCredential(null);
                setPage((n) => n + 1);
              }}
            >
              Next page
            </button>
          </>
        )}
      </section>
      {action && !uncertain && (
        <section className="import-panel" aria-label="Confirm staff update">
          <h2>Confirm {action.kind}</h2>
          <p>{action.email}</p>
          <p>
            {action.kind === "reset"
              ? "A new temporary password replaces the old password and revokes all existing sessions."
              : action.kind === "disable"
                ? "This staff member will lose access immediately."
                : "This staff member can sign in again with their current credential."}
          </p>
          <button disabled={pending} onClick={() => void perform()}>
            Confirm staff update
          </button>
          <button disabled={pending} onClick={() => setAction(null)}>
            Cancel
          </button>
        </section>
      )}
    </div>
  );
}
