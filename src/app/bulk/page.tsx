'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

import type { ReportJob } from '@/types/database';

export default function BulkReportsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeletingPast, setIsDeletingPast] = useState(false);

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

  const isPastJob = (status: ReportJob['status']) =>
    status === 'complete' || status === 'failed' || status === 'cancelled';

  const handleDeletePastJobs = async () => {
    const pastJobs = jobs.filter(j => isPastJob(j.status));
    if (pastJobs.length === 0) {
      alert('No hay trabajos finalizados para eliminar.');
      return;
    }

    const confirmed = window.confirm(
      `¿Eliminar ${pastJobs.length} trabajo(s) finalizado(s)? Esto los quitará de la lista.`
    );
    if (!confirmed) return;

    setIsDeletingPast(true);
    try {
      const response = await fetch('/api/bulk/jobs?scope=past', { method: 'DELETE' });
      const data = await response.json();

      if (!response.ok || data.error) {
        alert(`Error: ${data.error || 'No se pudo eliminar'}`);
        return;
      }

      await fetchJobs();
    } catch (error) {
      console.error('Error deleting past jobs:', error);
      alert('Error al eliminar trabajos finalizados');
    } finally {
      setIsDeletingPast(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      queued: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      cancelled: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    };

    const labels = {
      queued: 'En Cola',
      running: 'En Proceso',
      complete: 'Completo',
      failed: 'Fallido',
      cancelled: 'Cancelado',
    };

    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status as keyof typeof styles]}`}
      >
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <h1 className="text-xl font-bold sm:text-2xl">Paquetes SV - Reportes Masivos</h1>
            <Link href="/">
              <Button variant="outline" className="whitespace-nowrap px-3 text-sm sm:px-4">
                Volver a Consultas
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <CardTitle>Trabajos de Generación de PDFs</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={fetchJobs}
                  disabled={isLoading}
                  className="whitespace-nowrap px-3 text-sm sm:px-4"
                >
                  {isLoading ? 'Sincronizando...' : 'Sincronizar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDeletePastJobs}
                  disabled={isLoading || isDeletingPast}
                  className="whitespace-nowrap px-3 text-sm text-destructive hover:text-destructive sm:px-4"
                >
                  {isDeletingPast ? 'Eliminando...' : 'Eliminar finalizados'}
                </Button>
                <Button
                  onClick={handleCreateJob}
                  disabled={isCreating}
                  className="whitespace-nowrap px-3 text-sm sm:px-4"
                >
                  {isCreating ? 'Creando...' : 'Generar Todos los PDFs'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Cargando trabajos...</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <p>No hay trabajos aún.</p>
                <p className="mt-2 text-sm">
                  Haz clic en &quot;Generar Todos los PDFs&quot; para crear uno.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.map(job => (
                  <Link key={job.id} href={`/bulk/${job.id}`}>
                    <div className="cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent/50">
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
                            <div className="text-sm text-destructive">Error: {job.error}</div>
                          )}
                        </div>
                        {job.status === 'complete' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={e => {
                              e.preventDefault();
                              router.push(`/bulk/${job.id}`);
                            }}
                            className="whitespace-nowrap text-xs sm:text-sm"
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
