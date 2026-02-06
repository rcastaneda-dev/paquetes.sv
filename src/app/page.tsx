'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';

import { FiltersPanel } from '@/components/FiltersPanel';
import { StudentsGrid } from '@/components/StudentsGrid';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

import type { StudentQueryRow } from '@/types/database';

export default function HomePage() {
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
  const [students, setStudents] = useState<StudentQueryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingCajas, setIsGeneratingCajas] = useState(false);
  const [isGeneratingCamisas, setIsGeneratingCamisas] = useState(false);
  const [isGeneratingPantalones, setIsGeneratingPantalones] = useState(false);
  const [isGeneratingZapatos, setIsGeneratingZapatos] = useState(false);
  const pageSize = 50;

  const fetchStudents = async (page: number = 1) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });

      if (filters.school_codigo_ce) {
        params.append('school_codigo_ce', filters.school_codigo_ce);
      }
      if (filters.grado) {
        params.append('grado', filters.grado);
      }

      const response = await fetch(`/api/students/query?${params}`);
      const data = await response.json();

      if (data.error) {
        console.error('Error fetching students:', data.error);
        return;
      }

      setStudents(data.students || []);
      setTotalCount(data.totalCount || 0);
      setCurrentPage(page);
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
    fetchStudents(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handlePageChange = useCallback(
    (page: number) => {
      fetchStudents(page);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters]
  );

  const canGenerateReports = !!lastSearchFilters?.school_codigo_ce;

  const handleGenerateCajas = async () => {
    if (!lastSearchFilters?.school_codigo_ce) return;

    setIsGeneratingCajas(true);
    try {
      const params = new URLSearchParams();
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
      if (lastSearchFilters.grado) {
        params.set('grado', lastSearchFilters.grado);
      }

      window.open(`/api/reports/cajas?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingCajas(false);
    }
  };

  const handleGenerateCamisas = async () => {
    if (!lastSearchFilters?.school_codigo_ce) return;

    setIsGeneratingCamisas(true);
    try {
      const params = new URLSearchParams();
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
      if (lastSearchFilters.grado) {
        params.set('grado', lastSearchFilters.grado);
      }

      window.open(`/api/reports/camisas?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingCamisas(false);
    }
  };

  const handleGeneratePantalones = async () => {
    if (!lastSearchFilters?.school_codigo_ce) return;

    setIsGeneratingPantalones(true);
    try {
      const params = new URLSearchParams();
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
      if (lastSearchFilters.grado) {
        params.set('grado', lastSearchFilters.grado);
      }

      window.open(`/api/reports/pantalones?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingPantalones(false);
    }
  };

  const handleGenerateZapatos = async () => {
    if (!lastSearchFilters?.school_codigo_ce) return;

    setIsGeneratingZapatos(true);
    try {
      const params = new URLSearchParams();
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
      if (lastSearchFilters.grado) {
        params.set('grado', lastSearchFilters.grado);
      }

      window.open(`/api/reports/zapatos?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingZapatos(false);
    }
  };

  // Debug handlers for random 10-school PDFs
  const handleDebugCajas = () => {
    window.open('/api/reports/debug-random?type=cajas&limit=10', '_blank', 'noopener,noreferrer');
  };

  const handleDebugCamisas = () => {
    window.open('/api/reports/debug-random?type=camisas&limit=10', '_blank', 'noopener,noreferrer');
  };

  const handleDebugPantalones = () => {
    window.open(
      '/api/reports/debug-random?type=pantalones&limit=10',
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleDebugZapatos = () => {
    window.open('/api/reports/debug-random?type=zapatos&limit=10', '_blank', 'noopener,noreferrer');
  };

  const handleDebugFicha = () => {
    window.open('/api/reports/debug-random?type=ficha&limit=10', '_blank', 'noopener,noreferrer');
  };

  const handleDebugFichaUniformes = () => {
    window.open(
      '/api/reports/debug-random?type=ficha-uniformes&limit=10',
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleDebugFichaZapatos = () => {
    window.open(
      '/api/reports/debug-random?type=ficha-zapatos&limit=10',
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleDebugDayZapatos = () => {
    window.open(
      '/api/reports/debug-random?type=day-zapatos&limit=10',
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleDebugDayUniformes = () => {
    window.open(
      '/api/reports/debug-random?type=day-uniformes&limit=10',
      '_blank',
      'noopener,noreferrer'
    );
  };

  // Show debug buttons if explicitly enabled
  const showDebugButtons = process.env.NEXT_PUBLIC_ENABLE_DEBUG_BUTTONS === 'true';

  return (
    <div className="flex-1 bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Paquetes.sv</h1>
            <Link href="/bulk">
              <Button variant="outline">Reportes Masivos</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Consulta de Estudiantes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FiltersPanel onFilterChange={handleFilterChange} onSearch={handleSearch} />

            {canGenerateReports && (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium text-muted-foreground">Generar Reportes:</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    variant="outline"
                    onClick={handleGenerateCajas}
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
                    onClick={handleGenerateCamisas}
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
                    onClick={handleGeneratePantalones}
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
                    onClick={handleGenerateZapatos}
                    disabled={isGeneratingZapatos}
                    className="h-auto flex-col py-3"
                  >
                    <span className="text-base font-semibold">Zapatos</span>
                    <span className="text-xs text-muted-foreground">
                      {isGeneratingZapatos ? 'Generando...' : 'PDF'}
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
                  <Button
                    variant="outline"
                    onClick={handleDebugCajas}
                    className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                  >
                    <span className="text-base font-semibold">Cajas</span>
                    <span className="text-xs text-muted-foreground">10 escuelas</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugCamisas}
                    className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                  >
                    <span className="text-base font-semibold">Camisas</span>
                    <span className="text-xs text-muted-foreground">10 escuelas</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugPantalones}
                    className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                  >
                    <span className="text-base font-semibold">Pantalones</span>
                    <span className="text-xs text-muted-foreground">10 escuelas</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugZapatos}
                    className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                  >
                    <span className="text-base font-semibold">Zapatos</span>
                    <span className="text-xs text-muted-foreground">10 escuelas</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugFicha}
                    className="h-auto flex-col border-amber-300 py-3 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950"
                  >
                    <span className="text-base font-semibold">Ficha</span>
                    <span className="text-xs text-muted-foreground">10 escuelas</span>
                  </Button>
                </div>
                <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Fichas por Escuela y Día:
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    variant="outline"
                    onClick={handleDebugFichaUniformes}
                    className="h-auto flex-col border-emerald-300 py-3 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-950"
                  >
                    <span className="text-base font-semibold">Ficha Uniformes</span>
                    <span className="text-xs text-muted-foreground">Por escuela</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugFichaZapatos}
                    className="h-auto flex-col border-emerald-300 py-3 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-950"
                  >
                    <span className="text-base font-semibold">Ficha Zapatos</span>
                    <span className="text-xs text-muted-foreground">Por escuela</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugDayUniformes}
                    className="h-auto flex-col border-emerald-300 py-3 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-950"
                  >
                    <span className="text-base font-semibold">Day Uniformes</span>
                    <span className="text-xs text-muted-foreground">Consolidado</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDebugDayZapatos}
                    className="h-auto flex-col border-emerald-300 py-3 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-950"
                  >
                    <span className="text-base font-semibold">Day Zapatos</span>
                    <span className="text-xs text-muted-foreground">Consolidado</span>
                  </Button>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Cargando estudiantes...</p>
              </div>
            ) : (
              <StudentsGrid
                students={students}
                totalCount={totalCount}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
