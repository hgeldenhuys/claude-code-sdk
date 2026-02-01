import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <Meta />
        <Links />
      </head>
      <body
        className="bg-gray-950 text-gray-100 antialiased"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Error";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.toString() || message;
  } else if (error instanceof Error) {
    title = "Application Error";
    message = error.message;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-lg w-full bg-gray-900 rounded-xl border border-red-500/30 p-8">
        <h1 className="text-2xl font-bold text-red-400 mb-2">{title}</h1>
        <p className="text-gray-400 mb-4">{message}</p>
        {error instanceof Error && error.stack && (
          <pre
            className="text-xs text-gray-500 bg-gray-950 rounded-lg p-4 overflow-auto max-h-64"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  );
}
