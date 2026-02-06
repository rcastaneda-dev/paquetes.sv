'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function BulkError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('Bulk reports error:', error);
  }, [error]);

  return (
    <div className="flex-1 bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Reportes Masivos</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error en Reportes Masivos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No se pudo cargar la información de reportes. Por favor, intenta nuevamente.
            </p>
            {process.env.NODE_ENV === 'development' && (
              <details className="rounded-md bg-muted p-4">
                <summary className="cursor-pointer text-sm font-medium">Detalles del error</summary>
                <pre className="mt-2 overflow-auto text-xs">{error.message}</pre>
              </details>
            )}
            <div className="flex gap-2">
              <Button onClick={reset} className="flex-1">
                Intentar nuevamente
              </Button>
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full">
                  Volver al inicio
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
