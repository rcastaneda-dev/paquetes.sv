'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';

import { FiltersPanel } from '@/components/FiltersPanel';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

export default function ConsultaPage() {
  const [filters, setFilters] = useState<{ school_codigo_ce: string | null; grado: string | null }>(
    {
      school_codigo_ce: null,
      grado: null,
    }
  );
  const [lastSearchFilters, setLastSearchFilters] = useState<{
    school_codigo_ce: string | null;
    grado: string | null;
  } | null>(null);
  const [isGeneratingCajas, setIsGeneratingCajas] = useState(false);
  const [isGeneratingCamisas, setIsGeneratingCamisas] = useState(false);
  const [isGeneratingPantalones, setIsGeneratingPantalones] = useState(false);
  const [isGeneratingZapatos, setIsGeneratingZapatos] = useState(false);
  const [isGeneratingActaRecepcion, setIsGeneratingActaRecepcion] = useState(false);
  const [isGeneratingActaRecepcionUniformes, setIsGeneratingActaRecepcionUniformes] =
    useState(false);

  const handleFilterChange = useCallback(
    (newFilters: { school_codigo_ce: string | null; grado: string | null }) => {
      setFilters(newFilters);
      if (!newFilters.school_codigo_ce && !newFilters.grado) {
        setLastSearchFilters(null);
      }
    },
    []
  );

  const handleSearch = useCallback(() => {
    setLastSearchFilters(filters);
  }, [filters]);

  const canGenerateReports = !!lastSearchFilters?.school_codigo_ce;

  const buildParams = () => {
    const params = new URLSearchParams();
    if (lastSearchFilters?.school_codigo_ce) {
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
    }
    if (lastSearchFilters?.grado) {
      params.set('grado', lastSearchFilters.grado);
    }
    return params;
  };

  const handleGenerateReport = async (
    endpoint: string,
    setLoading: (v: boolean) => void
  ) => {
    if (!lastSearchFilters?.school_codigo_ce) return;
    setLoading(true);
    try {
      const params = buildParams();
      window.open(`${endpoint}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  };

  // Debug handlers for random 10-school PDFs
  const handleDebugReport = (type: string) => {
    window.open(`/api/reports/debug-random?type=${type}&limit=10`, '_blank', 'noopener,noreferrer');
  };

  const showDebugButtons = process.env.NEXT_PUBLIC_ENABLE_DEBUG_BUTTONS === 'true';

  return (
    <div className="flex-1 bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-balance text-2xl font-bold">Consulta por Escuela</h1>
            <Link href="/">
              <Button variant="outline" size="sm">
                Volver al inicio
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Buscar Escuela</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FiltersPanel onFilterChange={handleFilterChange} onSearch={handleSearch} />

            {canGenerateReports && (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium text-muted-foreground">Generar Reportes:</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Button
                    variant="outline"
                    onClick={() => handleGenerateReport('/api/reports/cajas', setIsGeneratingCajas)}
                    disabled={isGeneratingCajas}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-base font-semibold">Cajas</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingCajas ? 'Generando...' : 'PDF'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleGenerateReport('/api/reports/camisas', setIsGeneratingCamisas)
                    }
                    disabled={isGeneratingCamisas}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-base font-semibold">Camisas</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingCamisas ? 'Generando...' : 'PDF'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleGenerateReport('/api/reports/pantalones', setIsGeneratingPantalones)
                    }
                    disabled={isGeneratingPantalones}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-base font-semibold">Pantalones</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingPantalones ? 'Generando...' : 'PDF'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleGenerateReport('/api/reports/zapatos', setIsGeneratingZapatos)
                    }
                    disabled={isGeneratingZapatos}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-base font-semibold">Zapatos</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingZapatos ? 'Generando...' : 'PDF'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleGenerateReport(
                        '/api/reports/acta-recepcion-zapatos',
                        setIsGeneratingActaRecepcion
                      )
                    }
                    disabled={isGeneratingActaRecepcion}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-sm font-semibold">Actas Recepción</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingActaRecepcion ? 'Generando...' : 'Zapatos'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleGenerateReport(
                        '/api/reports/acta-recepcion-uniformes',
                        setIsGeneratingActaRecepcionUniformes
                      )
                    }
                    disabled={isGeneratingActaRecepcionUniformes}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-sm font-semibold">Actas Recepción</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingActaRecepcionUniformes ? 'Generando...' : 'Uniformes'}
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {showDebugButtons && (
              <div className="flex flex-col gap-3 border-t pt-6">
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  Debug: Generar PDFs con 10 escuelas aleatorias
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Cajas', type: 'cajas' },
                    { label: 'Camisas', type: 'camisas' },
                    { label: 'Pantalones', type: 'pantalones' },
                    { label: 'Zapatos', type: 'zapatos' },
                    { label: 'Ficha', type: 'ficha' },
                  ].map(({ label, type }) => (
                    <Button
                      key={type}
                      variant="outline"
                      onClick={() => handleDebugReport(type)}
                      className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                    >
                      <span className="text-base font-semibold">{label}</span>
                      <span className="text-xs text-muted-foreground">10 escuelas</span>
                    </Button>
                  ))}
                </div>
                <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Fichas por Escuela y Día:
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Ficha Uniformes', type: 'ficha-uniformes', sub: 'Por escuela' },
                    { label: 'Ficha Zapatos', type: 'ficha-zapatos', sub: 'Por escuela' },
                    { label: 'Day Uniformes', type: 'day-uniformes', sub: 'Consolidado' },
                    { label: 'Day Zapatos', type: 'day-zapatos', sub: 'Consolidado' },
                  ].map(({ label, type, sub }) => (
                    <Button
                      key={type}
                      variant="outline"
                      onClick={() => handleDebugReport(type)}
                      className="h-auto flex-col border-emerald-300 py-3 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-950"
                    >
                      <span className="text-base font-semibold">{label}</span>
                      <span className="text-xs text-muted-foreground">{sub}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {!canGenerateReports && (
              <div className="py-8 text-center text-muted-foreground">
                <p className="text-pretty">
                  Busca una escuela para generar reportes individuales.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
