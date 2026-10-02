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
        <p className="brand">
          Wedding Invitation<span>Admin</span>
        </p>
        <AdminNavigation />
        <div className="admin-account">
          <p className="identity">
            <span>OWNER</span> {email}
          </p>
          <LogoutButton csrfToken={csrfToken} />
        </div>
      </aside>
      <main id="main-content" className="admin-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
