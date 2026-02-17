'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ReportConfig {
  label: string;
  sublabel: string;
  format: string;
  endpoint: string;
}

const REPORTS: ReportConfig[] = [
  {
    label: 'Comanda de Cajas',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/comanda-cajas',
  },
  {
    label: 'Comanda de Cajas',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/comanda-cajas-word',
  },
  {
    label: 'Comanda de Uniformes',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/comanda-uniformes',
  },
  {
    label: 'Comanda de Uniformes',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/comanda-uniformes-word',
  },
  {
    label: 'Comanda de Zapatos',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/comanda-zapatos',
  },
  {
    label: 'Comanda de Zapatos',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/comanda-zapatos-word',
  },
  {
    label: 'Acta de Recepción de Cajas',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/acta-cajas',
  },
  {
    label: 'Acta de Recepción de Cajas',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/acta-cajas-word',
  },
  {
    label: 'Acta de Recepción de Uniformes',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/acta-uniformes',
  },
  {
    label: 'Acta de Recepción de Uniformes',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/acta-uniformes-word',
  },
  {
    label: 'Acta de Recepción de Zapatos',
    sublabel: 'PDF',
    format: 'pdf',
    endpoint: '/api/reports/demand/acta-zapatos',
  },
  {
    label: 'Acta de Recepción de Zapatos',
    sublabel: 'Word',
    format: 'docx',
    endpoint: '/api/reports/demand/acta-zapatos-word',
  },
  {
    label: 'Consolidado',
    sublabel: 'Excel',
    format: 'xlsx',
    endpoint: '/api/reports/demand/consolidado-excel',
  },
];

export default function DemandReportsPage() {
  const [schoolFilter, setSchoolFilter] = useState('');
  const [generating, setGenerating] = useState<string | null>(null);

  function handleGenerate(report: ReportConfig) {
    setGenerating(report.endpoint);
    const params = new URLSearchParams();
    if (schoolFilter.trim()) {
      params.set('school_codigo_ce', schoolFilter.trim());
    }
    const url = params.toString() ? `${report.endpoint}?${params.toString()}` : report.endpoint;
    window.open(url, '_blank', 'noopener,noreferrer');
    // Reset after a short delay (download starts immediately)
    setTimeout(() => setGenerating(null), 1500);
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reporte de Faltantes</h1>
        <div className="flex gap-2">
          <Link href="/staging/demand">
            <Button variant="outline" size="sm">
              Cargar datos
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline" size="sm">
              Volver al inicio
            </Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtrar por escuela (opcional)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              type="text"
              value={schoolFilter}
              onChange={e => setSchoolFilter(e.target.value)}
              placeholder="Código de centro escolar (ej: 11492)"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            {schoolFilter && (
              <Button variant="outline" size="sm" onClick={() => setSchoolFilter('')}>
                Limpiar
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Dejar vacío para generar reportes de todas las escuelas.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Descargar reportes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {REPORTS.map(report => (
              <Button
                key={report.endpoint}
                variant="outline"
                onClick={() => handleGenerate(report)}
                disabled={generating === report.endpoint}
                className="h-auto flex-col py-4"
              >
                <span className="text-sm font-semibold">{report.label}</span>
                <span className="text-xs text-muted-foreground">
                  {generating === report.endpoint ? 'Generando...' : report.sublabel}
                </span>
              </Button>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
            Estos reportes usan datos de la Base de Datos Normalizada. Las cantidades se muestran
            tal cual fueron cargadas — sin multiplicadores ni cálculos de vacíos.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
