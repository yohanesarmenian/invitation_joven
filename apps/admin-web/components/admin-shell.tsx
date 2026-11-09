import { LogoutButton } from "./logout-button";
import { AdminNavigation } from "./admin-navigation";
export function AdminShell({
  email,
  csrfToken,
  children,
}: {
  email: string;
  csrfToken: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="admin-sidebar" aria-label="Admin workspace">
        <div className="brand">
          <p className="brand-wordmark">
            heyjo<span>.</span>
          </p>
          <p className="brand-caption">Wedding workspace</p>
          <p className="brand-couple">Jo &amp; Venta</p>
        </div>
        <AdminNavigation />
        <div className="admin-account">
          <p className="identity">
            <span>OWNER workspace</span> {email}
          </p>
          <LogoutButton csrfToken={csrfToken} />
        </div>
      </aside>
      <main id="main-content" className="admin-main" tabIndex={-1}>
        <div className="workspace-context">
          <span>Jo &amp; Venta / Wedding workspace</span>
          <span className="workspace-owner">
            Personal invitations, thoughtfully managed
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
