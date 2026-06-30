import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import { PendingInvitesProvider } from './context/PendingInvitesContext';
import { LanguageProvider } from './context/LanguageContext';
import { SiteFooter } from './components/layout/SiteFooter';
import './styles.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="EvenUp - Gemeinsame Ausgaben einfach aufteilen" />
        <title>EvenUp</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
        <Meta />
        <Links />
        {/* Runs synchronously before first paint — applies dark class from localStorage
            or system preference so there is no flash of wrong theme on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem('evenup:theme');var dark=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);})()`,
          }}
        />
      </head>
      <body className="app-container">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <main className="main-content">
      <p className="text-muted-foreground text-center">Loading…</p>
    </main>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <PendingInvitesProvider>
          <Outlet />
          <SiteFooter />
        </PendingInvitesProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
