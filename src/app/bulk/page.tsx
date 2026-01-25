'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ReportJob } from '@/types/database';

export default function BulkReportsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/bulk/jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateJob = async () => {
    setIsCreating(true);
    try {
      const response = await fetch('/api/bulk/jobs', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      alert(`Trabajo creado exitosamente! ID: ${data.jobId}`);
      fetchJobs();
    } catch (error) {
      console.error('Error creating job:', error);
      alert('Error al crear el trabajo');
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      queued: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
    };

    const labels = {
      queued: 'En Cola',
      running: 'En Proceso',
      complete: 'Completo',
      failed: 'Fallido',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Paquetes SV - Reportes Masivos</h1>
            <Link href="/">
              <Button variant="outline">Volver a Consultas</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Trabajos de Generación de PDFs</CardTitle>
              <Button onClick={handleCreateJob} disabled={isCreating}>
                {isCreating ? 'Creando...' : 'Generar Todos los PDFs'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Cargando trabajos...</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No hay trabajos aún.</p>
                <p className="text-sm mt-2">Haz clic en "Generar Todos los PDFs" para crear uno.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <Link key={job.id} href={`/bulk/${job.id}`}>
                    <div className="border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm text-muted-foreground">
                              {job.id.slice(0, 8)}
                            </span>
                            {getStatusBadge(job.status)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Creado: {new Date(job.created_at).toLocaleString('es-SV')}
                          </div>
                          {job.error && (
                            <div className="text-sm text-destructive">
                              Error: {job.error}
                            </div>
                          )}
                        </div>
                        {job.status === 'complete' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.preventDefault();
                              router.push(`/bulk/${job.id}`);
                            }}
                          >
                            Ver descargas
                          </Button>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
