'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { FlowStepper } from '@/components/ui/FlowStepper';
import { UploadZone } from '@/components/ui/UploadZone';

const REQUIRED_COLUMNS = [
  'CODIGO',
  'DEPARTAMENTO',
  'DISTRITO',
  'FECHA',
  'ITEM',
  'TIPO',
  'CATEGORIA',
  'CANTIDAD',
];

const ALL_COLUMNS = [
  'CODIGO',
  'NOMBRE DE CENTRO ESCOLAR',
  'DEPARTAMENTO',
  'DISTRITO',
  'ZONA',
  'TIPO_DE_VEHICULO',
  'FECHA',
  'ITEM',
  'TIPO',
  'CATEGORIA',
  'CANTIDAD',
];

const CHUNK_SIZE = 1000;

const FLOW_STEPS = [
  { label: 'Cargar CSV', href: '/staging/demand' },
  { label: 'Descargar', href: '/reports/demand' },
];

interface UploadResult {
  success: boolean;
  data?: { schools: number; demand_rows: number; stagingRows: number };
  error?: string;
}

export default function DemandStagingPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleSubmit() {
    if (!selectedFile) {
      setResult({ success: false, error: 'No se seleccionó un archivo.' });
      return;
    }

    setResult(null);
    setIsUploading(true);
    setProgress('Leyendo archivo...');

    try {
      const text = await selectedFile.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

      if (lines.length < 2) {
        setResult({ success: false, error: 'El archivo CSV no contiene registros.' });
        setIsUploading(false);
        return;
      }

      const header = lines[0];

      // Validate required columns
      const delimiter = header.includes(';') ? ';' : ',';
      const columns = header.split(delimiter).map(c => c.replace(/^"|"$/g, '').trim());
      const missing = REQUIRED_COLUMNS.filter(col => !columns.includes(col));
      if (missing.length > 0) {
        setResult({
          success: false,
          error: `Columnas requeridas faltantes: ${missing.join(', ')}`,
        });
        setIsUploading(false);
        return;
      }

      const dataLines = lines.slice(1);
      const totalRows = dataLines.length;
      const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

      // Step 1: Truncate staging table
      setProgress('Limpiando tabla staging...');
      const truncateRes = await fetch('/api/staging/demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'truncate' }),
      });
      const truncateData = await truncateRes.json();
      if (truncateData.error) {
        setResult({ success: false, error: truncateData.error });
        setIsUploading(false);
        return;
      }

      // Step 2: Send chunks
      let insertedTotal = 0;
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const chunkLines = dataLines.slice(start, start + CHUNK_SIZE);
        const csvChunk = chunkLines.join('\n');

        setProgress(
          `Insertando lote ${i + 1} de ${totalChunks} (${insertedTotal.toLocaleString()} / ${totalRows.toLocaleString()} filas)...`
        );

        const insertRes = await fetch('/api/staging/demand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'insert', csvChunk, header, delimiter }),
        });
        const insertData = await insertRes.json();
        if (insertData.error) {
          setResult({
            success: false,
            error: `Error en lote ${i + 1}: ${insertData.error}`,
          });
          setIsUploading(false);
          return;
        }
        insertedTotal += insertData.inserted || chunkLines.length;
      }

      // Step 3: Run migration
      setProgress('Ejecutando migración de datos...');
      const migrateRes = await fetch('/api/staging/demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'migrate' }),
      });
      const migrateData = await migrateRes.json();
      if (migrateData.error) {
        setResult({ success: false, error: migrateData.error });
        setIsUploading(false);
        return;
      }

      setResult({
        success: true,
        data: { ...migrateData.data, stagingRows: insertedTotal },
      });
    } catch {
      setResult({
        success: false,
        error: 'Error de conexión. Verifica tu conexión e intenta de nuevo.',
      });
    } finally {
      setIsUploading(false);
      setProgress('');
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al inicio
        </Link>
      </div>

      <FlowStepper steps={FLOW_STEPS} currentStep={0} />

      <div className="mb-6">
        <h1 className="text-balance text-2xl font-bold">Cargar Base de Datos Faltantes</h1>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Sube el archivo CSV con las columnas requeridas para importar datos de demanda.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <UploadZone
            id="csv-file"
            accept=".csv"
            disabled={isUploading}
            onFileSelect={setSelectedFile}
            selectedFile={selectedFile}
            helpText="El archivo debe contener las 11 columnas requeridas"
            sampleDownloadHref="/sample-demand.csv"
            sampleDownloadLabel="Descargar archivo de ejemplo"
          />

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
            <strong>Formato esperado:</strong> CSV con 11 columnas ({ALL_COLUMNS.join(', ')}). Las
            cantidades se usan tal cual — sin multiplicadores ni cálculos de vacíos.
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <strong>Advertencia:</strong> Este proceso reemplazará todos los datos de demanda
            existentes. Las escuelas se actualizarán sin afectar los datos de estudiantes.
          </div>

          <Button onClick={handleSubmit} disabled={isUploading || !selectedFile} className="w-full">
            {isUploading ? 'Procesando...' : 'Cargar y Migrar Datos'}
          </Button>

          {isUploading && (
            <div className="flex flex-col items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950">
              <div className="size-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400" />
              <p className="text-pretty text-sm font-medium text-blue-800 dark:text-blue-200">
                {progress}
              </p>
            </div>
          )}

          {result && !result.success && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">Error</p>
              <p className="text-pretty">{result.error}</p>
            </div>
          )}

          {result?.success && result.data && (
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="mb-3 font-medium text-green-700 dark:text-green-400">
                Migración completada
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-gray-500 dark:text-gray-400">Filas CSV procesadas:</dt>
                <dd className="font-mono font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {result.data.stagingRows.toLocaleString()}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Escuelas cargadas:</dt>
                <dd className="font-mono font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {result.data.schools.toLocaleString()}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Filas de demanda:</dt>
                <dd className="font-mono font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {result.data.demand_rows.toLocaleString()}
                </dd>
              </dl>
              <Link href="/reports/demand">
                <Button variant="primary" className="mt-4 w-full">
                  Ver Reporte de Faltantes
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
