'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-destructive">Algo salió mal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ha ocurrido un error inesperado. Por favor, intenta nuevamente.
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
          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1">
              Intentar nuevamente
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = '/')}
              className="flex-1"
            >
              Volver al inicio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
