'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

const REQUIRED_COLUMNS = ['CODIGO', 'DEPARTAMENTO', 'DISTRITO', 'FECHA', 'ITEM', 'TIPO', 'CATEGORIA', 'CANTIDAD'];

const ALL_COLUMNS = [
  'CODIGO',
  'NOMBRE DE CENTRO ESCOLAR',
  'DEPARTAMENTO',
  'DISTRITO',
  'FECHA',
  'ITEM',
  'TIPO',
  'CATEGORIA',
  'CANTIDAD',
];

const CHUNK_SIZE = 1000;

interface UploadResult {
  success: boolean;
  data?: { schools: number; demand_rows: number; stagingRows: number };
  error?: string;
}

export default function DemandStagingPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);

    const fileInput = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) {
      setResult({ success: false, error: 'No se seleccionó un archivo.' });
      return;
    }

    setIsUploading(true);
    setProgress('Leyendo archivo...');

    try {
      const text = await file.text();
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cargar Base de Datos Normalizada</h1>
        <Link href="/">
          <Button variant="outline" size="sm">
            Volver al inicio
          </Button>
        </Link>
      </div>

      {/* Navigation tabs */}
      <div className="mb-4 flex gap-2">
        <Link href="/staging">
          <Button variant="outline" size="sm">
            Datos por Estudiante
          </Button>
        </Link>
        <Button variant="primary" size="sm" disabled>
          Base de Datos Normalizada
        </Button>
        <div className="ml-auto">
          <Link href="/reports/demand">
            <Button variant="outline" size="sm">
              Reporte de Faltantes
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Importar CSV normalizado</CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="csv-file" className="mb-1 block text-sm font-medium">
                Seleccionar archivo CSV
              </label>
              <input
                id="csv-file"
                name="file"
                type="file"
                accept=".csv"
                required
                disabled={isUploading}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500">
                El archivo debe contener las columnas: {REQUIRED_COLUMNS.join(', ')}.{' '}
                <a
                  href="/sample-demand.csv"
                  download
                  className="font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
                >
                  Descargar archivo de ejemplo
                </a>
              </p>
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <strong>Formato esperado:</strong> CSV con 9 columnas ({ALL_COLUMNS.join(', ')}). Las
              cantidades se usan tal cual — sin multiplicadores ni cálculos de vacíos.
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <strong>Advertencia:</strong> Este proceso reemplazará todos los datos de demanda
              existentes. Las escuelas se actualizarán sin afectar los datos de estudiantes.
            </div>

            <Button type="submit" disabled={isUploading} className="w-full">
              {isUploading ? 'Procesando...' : 'Cargar y Migrar Datos'}
            </Button>
          </form>

          {isUploading && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400" />
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">{progress}</p>
            </div>
          )}

          {result && !result.success && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">Error</p>
              <p>{result.error}</p>
            </div>
          )}

          {result?.success && result.data && (
            <div className="mt-4 rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="mb-3 font-medium text-green-700 dark:text-green-400">
                Migración completada
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-gray-500 dark:text-gray-400">Filas CSV procesadas:</dt>
                <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
                  {result.data.stagingRows.toLocaleString()}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Escuelas cargadas:</dt>
                <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
                  {result.data.schools.toLocaleString()}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Filas de demanda:</dt>
                <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
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
