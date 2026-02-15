'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { JobProgress } from '@/components/JobProgress';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

import type { ReportJob, ReportTask, JobProgress as JobProgressType } from '@/types/database';

// Extended type for tasks with school information
interface TaskWithSchool extends ReportTask {
  schools?: {
    nombre_ce: string;
  };
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<ReportJob | null>(null);
  const [progress, setProgress] = useState<JobProgressType | null>(null);
  const [tasks, setTasks] = useState<TaskWithSchool[]>([]);
  const [isCategoryJob, setIsCategoryJob] = useState(false);
  const [uniqueSchools, setUniqueSchools] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState<Record<string, boolean>>({});
  const [zipJobStatuses, setZipJobStatuses] = useState<
    Record<
      string,
      {
        status: 'queued' | 'processing' | 'complete' | 'failed';
        downloadUrl?: string;
        zipSizeMB?: string;
        pdfCount?: number;
        error?: string;
        progress?: {
          message?: string;
        };
      }
    >
  >({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [downloadingTasks, setDownloadingTasks] = useState<Record<string, boolean>>({});
  const [downloadingConsolidated, setDownloadingConsolidated] = useState<Record<string, boolean>>(
    {}
  );
  const [downloadingConsolidadoExcel, setDownloadingConsolidadoExcel] = useState(false);
  const [downloadingPivotExcel, setDownloadingPivotExcel] = useState(false);
  const [downloadingZapatosPivotExcel, setDownloadingZapatosPivotExcel] = useState(false);
  const [downloadingPivotExcelV2, setDownloadingPivotExcelV2] = useState(false);
  const [schoolBundleLoading, setSchoolBundleLoading] = useState(false);
  const [schoolBundleStatus, setSchoolBundleStatus] = useState<{
    status: 'queued' | 'processing' | 'complete' | 'failed';
    downloadUrl?: string;
    zipSizeMB?: string;
    pdfCount?: number;
    error?: string;
    progress?: { message?: string };
  } | null>(null);

  const fetchJobDetails = async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter) params.set('status', statusFilter);

      const url = `/api/bulk/jobs/${jobId}${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        console.error('Error:', data.error);
        return;
      }

      setJob(data.job);
      setProgress(data.progress);
      setTasks(data.tasks || []);
      setIsCategoryJob(data.isCategoryJob || false);
      setUniqueSchools(data.uniqueSchools ?? 0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, searchQuery, statusFilter]);

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      queued: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      cancelled: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    };

    const labels = {
      pending: 'Pendiente',
      running: 'En Proceso',
      complete: 'Completo',
      failed: 'Fallido',
      queued: 'En Cola',
      cancelled: 'Cancelado',
    };

    return (
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status as keyof typeof styles] || styles.pending}`}
      >
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const handleDownloadRegion = async (region: string) => {
    try {
      setLoadingRegions(prev => ({ ...prev, [region]: true }));

      // Step 1: Create ZIP job
      const createResponse = await fetch(
        `/api/bulk/jobs/${jobId}/create-zip-job?region=${region}`,
        { method: 'POST' }
      );
      const createData = await createResponse.json();

      if (!createResponse.ok) {
        alert(`Error: ${createData.error || 'Error al crear trabajo de ZIP'}`);
        setLoadingRegions(prev => ({ ...prev, [region]: false }));
        return;
      }

      const zipJobId = createData.zipJobId;

      // If already complete, download immediately
      if (createData.status === 'complete' && createData.downloadUrl) {
        window.open(createData.downloadUrl, '_blank');
        alert(
          `ZIP de ${region} descargado\n${createData.pdfCount || 0} PDFs, ${createData.zipSizeMB || 0} MB`
        );
        setLoadingRegions(prev => ({ ...prev, [region]: false }));
        return;
      }

      // Step 2: Poll for completion
      let attempts = 0;
      const maxAttempts = 120; // 10 minutes at 5 second intervals
      const pollInterval = 5000;

      const pollStatus = async () => {
        try {
          const statusResponse = await fetch(
            `/api/bulk/jobs/${jobId}/zip-job-status?zipJobId=${zipJobId}`
          );
          const statusData = await statusResponse.json();

          // Update local state for UI feedback
          setZipJobStatuses(prev => ({ ...prev, [region]: statusData }));

          if (statusData.status === 'complete' && statusData.downloadUrl) {
            // Success! Download the ZIP
            window.open(statusData.downloadUrl, '_blank');
            alert(
              `ZIP de ${region} generado exitosamente!\n${statusData.pdfCount || 0} PDFs, ${statusData.zipSizeMB || 0} MB`
            );
            setLoadingRegions(prev => ({ ...prev, [region]: false }));
            return true;
          }

          if (statusData.status === 'failed') {
            alert(`Error al generar ZIP de ${region}: ${statusData.error || 'Error desconocido'}`);
            setLoadingRegions(prev => ({ ...prev, [region]: false }));
            return true;
          }

          // Still processing or queued, continue polling
          attempts++;
          if (attempts >= maxAttempts) {
            alert(
              `Tiempo de espera agotado para ZIP de ${region}. Por favor, intenta de nuevo más tarde.`
            );
            setLoadingRegions(prev => ({ ...prev, [region]: false }));
            return true;
          }

          // Continue polling
          setTimeout(pollStatus, pollInterval);
          return false;
        } catch (err) {
          console.error('Error polling ZIP status:', err);
          attempts++;
          if (attempts >= maxAttempts) {
            alert(`Error al verificar el estado del ZIP de ${region}`);
            setLoadingRegions(prev => ({ ...prev, [region]: false }));
            return true;
          }
          setTimeout(pollStatus, pollInterval);
          return false;
        }
      };

      // Start polling
      pollStatus();
    } catch (error) {
      console.error(`Error downloading ${region}:`, error);
      alert(`Error al descargar ZIP de ${region}`);
      setLoadingRegions(prev => ({ ...prev, [region]: false }));
    }
  };

  const handleDownloadConsolidated = async (section: string) => {
    try {
      setDownloadingConsolidated(prev => ({ ...prev, [section]: true }));

      const response = await fetch(`/api/bulk/jobs/${jobId}/consolidated-pdf?type=${section}`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al generar PDF consolidado'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const fileNames: Record<string, string> = {
        cajas: 'consolidado_cajas.pdf',
        ficha_uniformes: 'consolidado_uniformes.pdf',
        ficha_zapatos: 'consolidado_zapatos.pdf',
        acta_recepcion_zapatos: 'consolidado_acta_recepcion_zapatos.pdf',
        acta_recepcion_uniformes: 'consolidado_acta_recepcion_uniformes.pdf',
      };
      a.download = fileNames[section] || `consolidado_${section}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(`Error downloading consolidated ${section}:`, error);
      alert(`Error al descargar PDF consolidado de ${section}`);
    } finally {
      setDownloadingConsolidated(prev => ({ ...prev, [section]: false }));
    }
  };

  const handleDownloadConsolidadoExcel = async () => {
    try {
      setDownloadingConsolidadoExcel(true);

      const response = await fetch(`/api/bulk/jobs/${jobId}/consolidado-excel`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al generar Consolidado Excel'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Consolidado_Portafolio.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading Consolidado Excel:', error);
      alert('Error al descargar Consolidado Excel');
    } finally {
      setDownloadingConsolidadoExcel(false);
    }
  };

  const handleDownloadPivotExcel = async () => {
    try {
      setDownloadingPivotExcel(true);

      const response = await fetch(`/api/bulk/jobs/${jobId}/consolidado-pivot-excel`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al generar Uniformes Acumulado Editable'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Uniformes_Acumulado_Editable.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading Uniformes Acumulado Editable:', error);
      alert('Error al descargar Uniformes Acumulado Editable Excel');
    } finally {
      setDownloadingPivotExcel(false);
    }
  };

  const handleDownloadZapatosPivotExcel = async () => {
    try {
      setDownloadingZapatosPivotExcel(true);

      const response = await fetch(`/api/bulk/jobs/${jobId}/zapatos-pivot-excel`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al generar Zapatos Acumulado Editable'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Zapatos_Acumulado_Editable.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading Zapatos Acumulado Editable:', error);
      alert('Error al descargar Zapatos Acumulado Editable');
    } finally {
      setDownloadingZapatosPivotExcel(false);
    }
  };

  const handleDownloadPivotExcelV2 = async () => {
    try {
      setDownloadingPivotExcelV2(true);

      const response = await fetch(`/api/bulk/jobs/${jobId}/consolidado-pivot-excel-v2`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al generar Prendas Acumulado Editable V2'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Consolidado_Prendas_Final.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading Prendas Acumulado Editable V2:', error);
      alert('Error al descargar Prendas Acumulado Editable V2');
    } finally {
      setDownloadingPivotExcelV2(false);
    }
  };

  const handleDownloadSchoolBundle = async () => {
    try {
      setSchoolBundleLoading(true);

      // Step 1: Create school bundle ZIP job
      const createResponse = await fetch(`/api/bulk/jobs/${jobId}/create-school-bundle-zip-job`, {
        method: 'POST',
      });
      const createData = await createResponse.json();

      if (!createResponse.ok) {
        alert(`Error: ${createData.error || 'Error al crear trabajo de ZIP'}`);
        setSchoolBundleLoading(false);
        return;
      }

      const zipJobId = createData.zipJobId;

      // If already complete, download immediately
      if (createData.status === 'complete' && createData.downloadUrl) {
        window.open(createData.downloadUrl, '_blank');
        alert(
          `Archivo comprimido descargado\n${createData.pdfCount || 0} PDFs, ${createData.zipSizeMB || 0} MB`
        );
        setSchoolBundleLoading(false);
        return;
      }

      // Step 2: Poll for completion
      let attempts = 0;
      const maxAttempts = 180; // 15 minutes at 5 second intervals (can be long for many schools)
      const pollInterval = 5000;

      const pollStatus = async () => {
        try {
          const statusResponse = await fetch(
            `/api/bulk/jobs/${jobId}/school-bundle-zip-status?zipJobId=${zipJobId}`
          );
          const statusData = await statusResponse.json();

          setSchoolBundleStatus(statusData);

          if (statusData.status === 'complete' && statusData.downloadUrl) {
            window.open(statusData.downloadUrl, '_blank');
            alert(
              `Archivo comprimido generado exitosamente!\n${statusData.pdfCount || 0} PDFs, ${statusData.zipSizeMB || 0} MB`
            );
            setSchoolBundleLoading(false);
            return true;
          }

          if (statusData.status === 'failed') {
            alert(
              `Error al generar archivo comprimido: ${statusData.error || 'Error desconocido'}`
            );
            setSchoolBundleLoading(false);
            return true;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            alert(
              'Tiempo de espera agotado para archivo comprimido. Por favor, intenta de nuevo más tarde.'
            );
            setSchoolBundleLoading(false);
            return true;
          }

          setTimeout(pollStatus, pollInterval);
          return false;
        } catch (err) {
          console.error('Error polling school bundle ZIP status:', err);
          attempts++;
          if (attempts >= maxAttempts) {
            alert('Error al verificar el estado del archivo comprimido');
            setSchoolBundleLoading(false);
            return true;
          }
          setTimeout(pollStatus, pollInterval);
          return false;
        }
      };

      pollStatus();
    } catch (error) {
      console.error('Error downloading school bundle:', error);
      alert('Error al descargar archivo comprimido');
      setSchoolBundleLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!job) return;

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas cancelar este trabajo? Las tareas en proceso se detendrán y no se podrán reanudar.'
    );

    if (!confirmed) return;

    try {
      setIsCancelling(true);
      const response = await fetch(`/api/bulk/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Cancelled by user' }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(`Error al cancelar: ${data.error || 'Error desconocido'}`);
        return;
      }

      alert(`Trabajo cancelado exitosamente. ${data.tasksCancelled} tareas canceladas.`);
      await fetchJobDetails();
    } catch (error) {
      console.error('Error cancelling job:', error);
      alert('Error al cancelar el trabajo');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDownloadTask = async (taskId: string, schoolName: string) => {
    try {
      setDownloadingTasks(prev => ({ ...prev, [taskId]: true }));

      const response = await fetch(`/api/bulk/tasks/${taskId}/download`);

      if (!response.ok) {
        const data = await response.json();
        alert(`Error: ${data.error || 'Error al descargar PDFs'}`);
        return;
      }

      const contentType = response.headers.get('Content-Type') || '';
      const ext = contentType.includes('application/pdf') ? '.pdf' : '.zip';

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${schoolName}${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading task PDFs:', error);
      alert('Error al descargar PDFs');
    } finally {
      setDownloadingTasks(prev => ({ ...prev, [taskId]: false }));
    }
  };

  const handleRetryFailed = async () => {
    if (!job) return;

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas reintentar las tareas fallidas? El trabajo se reiniciará y las tareas fallidas se volverán a procesar.'
    );

    if (!confirmed) return;

    try {
      setIsRetrying(true);
      const response = await fetch(`/api/bulk/jobs/${jobId}/retry-failed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(`Error al reintentar: ${data.error || 'Error desconocido'}`);
        return;
      }

      alert(`Reintento exitoso. ${data.tasksRetried} tarea(s) reintentándose.`);
      await fetchJobDetails();
    } catch (error) {
      console.error('Error retrying failed tasks:', error);
      alert('Error al reintentar las tareas fallidas');
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="mt-4 text-muted-foreground">Cargando detalles del trabajo...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="mb-4 text-muted-foreground">Trabajo no encontrado</p>
            <Button onClick={() => router.push('/bulk')}>Volver a Trabajos</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <h1 className="text-2xl font-bold">Detalles del Trabajo</h1>
            <Link href="/bulk">
              <Button variant="outline" className="whitespace-nowrap px-3 text-sm sm:px-4">
                Volver a Trabajos
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-8">
        {/* Job info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-mono text-lg">{job.id}</CardTitle>
                <div className="mt-2 flex items-center gap-2">
                  {getStatusBadge(job.status)}
                  <span className="text-sm text-muted-foreground">
                    Creado: {new Date(job.created_at).toLocaleString('es-SV')}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {isCategoryJob && uniqueSchools > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5">
                    <span className="text-2xl font-bold text-primary">{uniqueSchools}</span>
                    <span className="text-sm text-muted-foreground">
                      {uniqueSchools === 1 ? 'Centro Escolar' : 'Centros Escolares'}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(job.status === 'queued' || job.status === 'running') && (
                    <Button
                      variant="outline"
                      onClick={handleCancelJob}
                      disabled={isCancelling}
                      className="whitespace-nowrap px-3 text-sm text-destructive hover:text-destructive sm:px-4"
                    >
                      {isCancelling ? 'Cancelando...' : 'Cancelar Trabajo'}
                    </Button>
                  )}
                  {(job.status === 'failed' || job.status === 'complete') &&
                    progress &&
                    progress.failed_tasks > 0 && (
                      <Button
                        variant="outline"
                        onClick={handleRetryFailed}
                        disabled={isRetrying}
                        className="whitespace-nowrap px-3 text-sm text-blue-600 hover:text-blue-700 sm:px-4 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {isRetrying ? 'Reintentando...' : 'Reintentar Fallidos'}
                      </Button>
                    )}
                </div>
              </div>
            </div>
          </CardHeader>
          {progress && (
            <CardContent>
              <JobProgress progress={progress} />
            </CardContent>
          )}
        </Card>

        {/* Regional Downloads (for regular jobs) */}
        {!isCategoryJob && (job.status === 'complete' || job.status === 'failed') && (
          <Card>
            <CardHeader>
              <CardTitle>Descargar PDFs por Región</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {job.status === 'failed' && progress && progress.failed_tasks > 0 && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm dark:border-yellow-800 dark:bg-yellow-950/20">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    ⚠️ Algunos PDFs fallaron
                  </p>
                  <p className="mt-1 text-yellow-700 dark:text-yellow-300">
                    {progress.failed_tasks} tarea(s) fallida(s). Las descargas contienen solo los
                    PDFs generados exitosamente.
                  </p>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Haz clic en una región para generar y descargar el archivo ZIP (PDFs incluidos:
                tallas y etiquetas, toma alrededor de 1-3 minutos)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {['oriental', 'occidental', 'paracentral', 'central'].map(region => {
                  const zipStatus = zipJobStatuses[region];
                  const isLoading = loadingRegions[region];

                  let statusText = 'Descargar ZIP';
                  if (isLoading && zipStatus?.progress?.message) {
                    statusText = zipStatus.progress.message;
                  } else if (isLoading) {
                    statusText = 'Generando ZIP...';
                  }

                  return (
                    <Button
                      key={region}
                      onClick={() => handleDownloadRegion(region)}
                      disabled={isLoading}
                      variant="outline"
                      className="h-auto flex-col items-start p-4"
                    >
                      <span className="text-lg font-semibold capitalize">{region}</span>
                      <span className="text-xs text-muted-foreground">{statusText}</span>
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                La descarga comenzará automáticamente cuando esté listo.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Consolidated PDFs (for category jobs) */}
        {isCategoryJob && (job.status === 'complete' || job.status === 'failed') && (
          <Card>
            <CardHeader>
              <CardTitle>PDFs Consolidados</CardTitle>
              <CardDescription>
                Genera un solo PDF que combina todas las escuelas para la fecha seleccionada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { key: 'cajas', label: 'Consolidado Cajas' },
                  { key: 'ficha_uniformes', label: 'Consolidado Uniformes' },
                  { key: 'ficha_zapatos', label: 'Consolidado Zapatos' },
                  {
                    key: 'acta_recepcion_zapatos',
                    label: 'Consolidado Actas de Recepcion (Zapatos)',
                  },
                  {
                    key: 'acta_recepcion_uniformes',
                    label: 'Consolidado Actas de Recepcion (Uniformes)',
                  },
                ].map(({ key, label }) => {
                  const isDownloading = downloadingConsolidated[key];
                  return (
                    <Button
                      key={key}
                      onClick={() => handleDownloadConsolidated(key)}
                      disabled={isDownloading}
                      variant="outline"
                      className="h-auto flex-col items-start p-4"
                    >
                      <span className="text-lg font-semibold">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {isDownloading ? 'Generando PDF...' : 'Descargar PDF'}
                      </span>
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                El PDF se generará al momento y se descargará automáticamente.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Consolidated Excel files (for category jobs) */}
        {isCategoryJob && (job.status === 'complete' || job.status === 'failed') && (
          <Card>
            <CardHeader>
              <CardTitle>Excel Consolidados</CardTitle>
              <CardDescription>
                Descarga archivos Excel con datos consolidados de todas las escuelas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Button
                  onClick={handleDownloadConsolidadoExcel}
                  disabled={downloadingConsolidadoExcel}
                  variant="outline"
                  className="h-auto flex-col items-start p-4"
                >
                  <span className="text-lg font-semibold">Consolidado Excel</span>
                  <span className="text-xs text-muted-foreground">
                    {downloadingConsolidadoExcel ? 'Generando Excel...' : 'Descargar .xlsx'}
                  </span>
                </Button>
                <Button
                  onClick={handleDownloadPivotExcel}
                  disabled={downloadingPivotExcel}
                  variant="outline"
                  className="h-auto flex-col items-start p-4"
                >
                  <span className="text-lg font-semibold">Uniformes Acumulado Editable</span>
                  <span className="text-xs text-muted-foreground">
                    {downloadingPivotExcel ? 'Generando Excel...' : 'Descargar .xlsx'}
                  </span>
                </Button>
                <Button
                  onClick={handleDownloadZapatosPivotExcel}
                  disabled={downloadingZapatosPivotExcel}
                  variant="outline"
                  className="h-auto flex-col items-start p-4"
                >
                  <span className="text-lg font-semibold">Zapatos Acumulado Editable</span>
                  <span className="text-xs text-muted-foreground">
                    {downloadingZapatosPivotExcel ? 'Generando Excel...' : 'Descargar .xlsx'}
                  </span>
                </Button>
                <Button
                  onClick={handleDownloadPivotExcelV2}
                  disabled={downloadingPivotExcelV2}
                  variant="outline"
                  className="h-auto flex-col items-start p-4"
                >
                  <span className="text-lg font-semibold">Prendas Acumulado Editable (V2)</span>
                  <span className="text-xs text-muted-foreground">
                    {downloadingPivotExcelV2 ? 'Generando Excel...' : 'Descargar .xlsx'}
                  </span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                El archivo Excel se generará al momento y se descargará automáticamente.
              </p>
            </CardContent>
          </Card>
        )}

        {/* School Bundle ZIP (for category jobs) */}
        {isCategoryJob && (job.status === 'complete' || job.status === 'failed') && (
          <Card>
            <CardHeader>
              <CardTitle>Archivo Comprimido</CardTitle>
              <CardDescription>
                Genera un ZIP con un PDF por cada escuela. Cada PDF combina Cajas + Uniformes +
                Zapatos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={handleDownloadSchoolBundle}
                disabled={schoolBundleLoading}
                variant="outline"
                className="h-auto w-full flex-col items-start p-4 sm:w-auto"
              >
                <span className="text-lg font-semibold">Generar Archivo Comprimido</span>
                <span className="text-xs text-muted-foreground">
                  {schoolBundleLoading && schoolBundleStatus?.progress?.message
                    ? schoolBundleStatus.progress.message
                    : schoolBundleLoading
                      ? 'Generando ZIP (puede tardar entre 3 y 10 minutos)...'
                      : 'Un PDF por escuela (Cajas + Uniformes + Zapatos)'}
                </span>
              </Button>
              {schoolBundleStatus?.status === 'complete' && schoolBundleStatus.downloadUrl && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950/20">
                  <p className="font-medium text-green-800 dark:text-green-200">
                    ✅ Archivo comprimido listo ({schoolBundleStatus.pdfCount} PDFs,{' '}
                    {schoolBundleStatus.zipSizeMB} MB)
                  </p>
                  <a
                    href={schoolBundleStatus.downloadUrl}
                    className="mt-1 inline-block text-green-700 underline hover:text-green-900 dark:text-green-300 dark:hover:text-green-100"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Descargar de nuevo
                  </a>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                La descarga comenzará automáticamente cuando esté listo.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Tasks list */}
        <Card>
          <CardHeader>
            <CardTitle>PDFs ({progress?.total_tasks ?? 0})</CardTitle>
            <CardDescription>
              Busca y filtra PDFs individuales por código CE o nombre. Haz clic en el título para
              descargar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Search and Filter Controls */}
            {!isCategoryJob && (
              <div className="mb-4 flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <Input
                    type="text"
                    placeholder="Buscar por código CE o nombre..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="w-full sm:w-48">
                  <Select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="w-full"
                  >
                    <option value="">Todos los estados</option>
                    <option value="pending">Pendiente</option>
                    <option value="running">En Proceso</option>
                    <option value="complete">Completo</option>
                    <option value="failed">Fallido</option>
                    <option value="cancelled">Cancelado</option>
                  </Select>
                </div>
                {(searchQuery || statusFilter) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('');
                    }}
                    className="sm:w-auto"
                  >
                    Limpiar
                  </Button>
                )}
              </div>
            )}

            {/* Filters for category jobs */}
            {isCategoryJob && (
              <div className="mb-4 flex flex-col gap-3">
                <div className="flex gap-3">
                  <Select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="w-48"
                  >
                    <option value="">Todos los estados</option>
                    <option value="pending">Pendiente</option>
                    <option value="running">En Proceso</option>
                    <option value="complete">Completo</option>
                    <option value="failed">Fallido</option>
                  </Select>
                  {(statusFilter || searchQuery) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatusFilter('');
                        setSearchQuery('');
                      }}
                    >
                      Limpiar
                    </Button>
                  )}
                </div>
                <Input
                  type="text"
                  placeholder="Buscar por código CE o nombre de centro escolar..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full"
                />
              </div>
            )}

            <div className="max-h-[600px] space-y-2 overflow-y-auto">
              {tasks.map(task => {
                const isComplete = task.status === 'complete' && task.pdf_path;
                const isDownloading = downloadingTasks[task.id];

                // Category job task display
                if (isCategoryJob) {
                  const categoryTask = task as TaskWithSchool & { category: string };
                  const categoryLabels: Record<string, string> = {
                    estudiantes: 'Cajas',
                    camisa: 'Camisas',
                    prenda_inferior: 'Prenda Inferior',
                    zapatos: 'Zapatos',
                    ficha_uniformes: 'Ficha Uniformes',
                    ficha_zapatos: 'Ficha Zapatos',
                  };

                  return (
                    <div key={task.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div
                            className={`font-medium ${isComplete ? 'cursor-pointer text-blue-600 hover:underline dark:text-blue-400' : ''} ${isDownloading ? 'opacity-50' : ''}`}
                            onClick={() => {
                              if (isComplete && !isDownloading) {
                                handleDownloadTask(task.id, categoryTask.category);
                              }
                            }}
                            title={isComplete ? 'Click para descargar PDF' : 'PDF no disponible'}
                          >
                            {isDownloading && '⏬ '}
                            {categoryLabels[categoryTask.category] || categoryTask.category}
                            {task.schools?.nombre_ce ? ` - ${task.schools.nombre_ce}` : ''}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Fecha:{' '}
                            {(() => {
                              if (
                                job?.job_params &&
                                typeof job.job_params === 'object' &&
                                'fecha_inicio' in job.job_params &&
                                typeof job.job_params.fecha_inicio === 'string'
                              ) {
                                return new Date(job.job_params.fecha_inicio).toLocaleDateString(
                                  'es-SV'
                                );
                              }
                              return 'N/A';
                            })()}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Actualizado: {new Date(task.updated_at).toLocaleString('es-SV')}
                          </div>
                          {task.error && (
                            <div className="mt-1 text-xs text-destructive">Error: {task.error}</div>
                          )}
                        </div>
                        <div>{getStatusBadge(task.status)}</div>
                      </div>
                    </div>
                  );
                }

                // Regular school task display
                return (
                  <div key={task.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div
                          className={`font-medium ${isComplete ? 'cursor-pointer text-blue-600 hover:underline dark:text-blue-400' : ''} ${isDownloading ? 'opacity-50' : ''}`}
                          onClick={() => {
                            if (isComplete && !isDownloading) {
                              const schoolName = `${task.school_codigo_ce}-${task.grado}`;
                              handleDownloadTask(task.id, schoolName);
                            }
                          }}
                          title={
                            isComplete
                              ? 'Click para descargar PDFs (tallas y etiquetas)'
                              : 'PDFs no disponibles'
                          }
                        >
                          {isDownloading && '⏬ '}
                          {task.school_codigo_ce} - {task.schools?.nombre_ce || 'Sin nombre'}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Grado: {task.grado === 'ALL' ? 'Todos' : task.grado}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Actualizado: {new Date(task.updated_at).toLocaleString('es-SV')}
                        </div>
                        {task.error && (
                          <div className="mt-1 text-xs text-destructive">Error: {task.error}</div>
                        )}
                        {task.attempt_count > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Intentos: {task.attempt_count}
                          </div>
                        )}
                      </div>
                      <div>{getStatusBadge(task.status)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
