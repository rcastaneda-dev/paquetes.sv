'use client';

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="bg-card text-card-foreground w-full max-w-md space-y-4 rounded-lg border p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-destructive">Error crítico</h2>
            <p className="text-sm text-muted-foreground">
              Ha ocurrido un error crítico en la aplicación. Por favor, recarga la página.
            </p>
            {process.env.NODE_ENV === 'development' && (
              <details className="rounded-md bg-muted p-4">
                <summary className="cursor-pointer text-sm font-medium">Detalles del error</summary>
                <pre className="mt-2 overflow-auto text-xs">{error.message}</pre>
                {error.digest && (
                  <p className="mt-2 text-xs text-muted-foreground">Error ID: {error.digest}</p>
                )}
              </details>
            )}
            <button
              onClick={reset}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Intentar nuevamente
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
