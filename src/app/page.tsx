'use client';

import { useState } from 'react';
import { FiltersPanel } from '@/components/FiltersPanel';
import { StudentsGrid } from '@/components/StudentsGrid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { StudentQueryRow } from '@/types/database';
import Link from 'next/link';

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
  const [isPrinting, setIsPrinting] = useState(false);
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

  const handleFilterChange = (newFilters: {
    school_codigo_ce: string | null;
    grado: string | null;
  }) => {
    setFilters(newFilters);
    if (!newFilters.school_codigo_ce && !newFilters.grado) {
      setLastSearchFilters(null);
    }
  };

  const handleSearch = () => {
    setLastSearchFilters(filters);
    fetchStudents(1);
  };

  const handlePageChange = (page: number) => {
    fetchStudents(page);
  };

  const canPrint = !!lastSearchFilters?.school_codigo_ce;

  const handlePrint = async () => {
    if (!lastSearchFilters?.school_codigo_ce) return;

    setIsPrinting(true);
    try {
      const params = new URLSearchParams();
      params.set('school_codigo_ce', lastSearchFilters.school_codigo_ce);
      if (lastSearchFilters.grado) {
        params.set('grado', lastSearchFilters.grado);
      }

      // Open the generated PDF in a new tab; user can Print -> Save as PDF.
      window.open(`/api/students/print?${params.toString()}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Paquetes SV</h1>
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

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={handlePrint}
                disabled={!canPrint || isPrinting}
                title={
                  !canPrint
                    ? 'Selecciona una escuela y realiza una búsqueda para imprimir.'
                    : undefined
                }
              >
                {isPrinting ? 'Generando PDF...' : 'Imprimir (PDF)'}
              </Button>
            </div>

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
