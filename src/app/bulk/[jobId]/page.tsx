'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { JobProgress } from '@/components/JobProgress';
import type { ReportJob, ReportTask, JobProgress as JobProgressType } from '@/types/database';

interface ZipPartDownload {
  partNo: number;
  pdfCount: number;
  downloadUrl: string;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<ReportJob | null>(null);
  const [progress, setProgress] = useState<JobProgressType | null>(null);
  const [tasks, setTasks] = useState<ReportTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [zipManifestUrl, setZipManifestUrl] = useState<string | null>(null);
  const [zipParts, setZipParts] = useState<ZipPartDownload[]>([]);
  const [zipTotalParts, setZipTotalParts] = useState<number>(0);
  const [zipNextOffset, setZipNextOffset] = useState<number | null>(0);
  const [isZipLoading, setIsZipLoading] = useState(false);

  const fetchJobDetails = async () => {
    try {
      const response = await fetch(`/api/bulk/jobs/${jobId}`);
      const data = await response.json();

      if (data.error) {
        console.error('Error:', data.error);
        return;
      }

      setJob(data.job);
      setProgress(data.progress);
      setTasks(data.tasks || []);
    } catch (error) {
      console.error('Error fetching job details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobDetails();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchJobDetails, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
    };

    const labels = {
      pending: 'Pendiente',
      running: 'En Proceso',
      complete: 'Completo',
      failed: 'Fallido',
      queued: 'En Cola',
    };

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status as keyof typeof styles] || styles.pending}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const handleDownload = async () => {
    try {
      setIsZipLoading(true);
      const response = await fetch(`/api/bulk/jobs/${jobId}/download?limit=50&offset=0`);
      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
        return;
      }

      // Multi-part ZIP flow
      setZipManifestUrl(data.manifestUrl ?? null);
      setZipTotalParts(data.totalParts ?? 0);
      setZipNextOffset(data.nextOffset ?? null);
      setZipParts((data.parts ?? []) as ZipPartDownload[]);
    } catch (error) {
      console.error('Error downloading:', error);
      alert('Error al descargar el archivo');
    } finally {
      setIsZipLoading(false);
    }
  };

  const handleLoadMoreZipParts = async () => {
    if (zipNextOffset == null) return;
    try {
      setIsZipLoading(true);
      const response = await fetch(`/api/bulk/jobs/${jobId}/download?limit=50&offset=${zipNextOffset}`);
      const data = await response.json();
      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }
      setZipManifestUrl(data.manifestUrl ?? zipManifestUrl);
      setZipTotalParts(data.totalParts ?? zipTotalParts);
      setZipNextOffset(data.nextOffset ?? null);
      setZipParts((prev) => [...prev, ...((data.parts ?? []) as ZipPartDownload[])]);
    } finally {
      setIsZipLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-4 text-muted-foreground">Cargando detalles del trabajo...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-4">Trabajo no encontrado</p>
            <Button onClick={() => router.push('/bulk')}>Volver a Trabajos</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Detalles del Trabajo</h1>
            <Link href="/bulk">
              <Button variant="outline">Volver a Trabajos</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Job info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-mono text-lg">{job.id}</CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  {getStatusBadge(job.status)}
                  <span className="text-sm text-muted-foreground">
                    Creado: {new Date(job.created_at).toLocaleString('es-SV')}
                  </span>
                </div>
              </div>
              {job.status === 'complete' && (
                <Button onClick={handleDownload} disabled={isZipLoading}>
                  {isZipLoading ? 'Cargando...' : 'Ver descargas'}
                </Button>
              )}
            </div>
          </CardHeader>
          {progress && (
            <CardContent>
              <JobProgress progress={progress} />
            </CardContent>
          )}
        </Card>

        {/* Downloads */}
        {job.status === 'complete' && (zipManifestUrl || zipParts.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Descargas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {zipManifestUrl && (
                <div className="text-sm">
                  <a
                    href={zipManifestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Descargar manifest (JSON)
                  </a>
                </div>
              )}

              {zipTotalParts > 0 && (
                <div className="text-sm text-muted-foreground">
                  ZIP parts: {zipParts.length} visibles / {zipTotalParts} total
                </div>
              )}

              {zipParts.length > 0 ? (
                <div className="space-y-2">
                  {zipParts.map((p) => (
                    <div key={p.partNo} className="flex items-center justify-between border rounded-lg p-3 text-sm">
                      <div>
                        <div className="font-medium">Parte {p.partNo}</div>
                        <div className="text-xs text-muted-foreground">{p.pdfCount} PDFs</div>
                      </div>
                      <a href={p.downloadUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline">Descargar</Button>
                      </a>
                    </div>
                  ))}

                  {zipNextOffset != null && (
                    <Button variant="outline" onClick={handleLoadMoreZipParts} disabled={isZipLoading}>
                      {isZipLoading ? 'Cargando...' : 'Cargar más partes'}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Las partes todavía se están generando. Vuelve a intentar en unos minutos.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tasks list */}
        <Card>
          <CardHeader>
            <CardTitle>Tareas ({tasks.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {tasks.map((task) => (
                <div key={task.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium">
                        {task.school_codigo_ce} - {task.grado}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Actualizado: {new Date(task.updated_at).toLocaleString('es-SV')}
                      </div>
                      {task.error && (
                        <div className="text-xs text-destructive mt-1">
                          Error: {task.error}
                        </div>
                      )}
                      {task.attempt_count > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Intentos: {task.attempt_count}
                        </div>
                      )}
                    </div>
                    <div>
                      {getStatusBadge(task.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
