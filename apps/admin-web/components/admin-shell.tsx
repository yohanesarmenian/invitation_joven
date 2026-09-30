import { LogoutButton } from "./logout-button";
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
      <header className="admin-header">
        <div>
          <p className="brand">Wedding Invitation Admin</p>
          <p className="identity">
            <span>OWNER</span> {email}
          </p>
        </div>
        <LogoutButton csrfToken={csrfToken} />
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
