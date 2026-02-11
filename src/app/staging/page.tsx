'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

import { uploadStagingCSV } from './actions';

export default function StagingPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    data?: { schools: number; students: number; sizes: number; stagingRows: number };
    error?: string;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    setIsUploading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const response = await uploadStagingCSV(formData);
      setResult(response);
    } catch {
      setResult({ success: false, error: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cargar Datos CSV</h1>
        <Link href="/">
          <Button variant="outline" size="sm">
            Volver al inicio
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Importar archivo CSV</CardTitle>
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
                El archivo debe contener las 21 columnas requeridas.{' '}
                <a
                  href="/sample-staging.csv"
                  download
                  className="font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
                >
                  Descargar archivo de ejemplo
                </a>
              </p>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <strong>Advertencia:</strong> Este proceso reemplazará todos los datos existentes de
              escuelas, estudiantes y tallas. Asegúrate de que el archivo CSV esté completo y
              correcto.
            </div>

            <Button type="submit" disabled={isUploading} className="w-full">
              {isUploading ? 'Procesando...' : 'Cargar y Migrar Datos'}
            </Button>
          </form>

          {isUploading && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400" />
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Procesando archivo CSV...
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Esto puede tomar varios segundos dependiendo del tamaño del archivo.
              </p>
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
                <dt className="text-gray-500 dark:text-gray-400">Estudiantes cargados:</dt>
                <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
                  {result.data.students.toLocaleString()}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Tallas registradas:</dt>
                <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
                  {result.data.sizes.toLocaleString()}
                </dd>
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
