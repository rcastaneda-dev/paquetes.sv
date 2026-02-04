'use client';

import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import { memo, useMemo } from 'react';
import type { StudentQueryRow } from '@/types/database';
import { Button } from './ui/Button';

interface StudentsGridProps {
  students: StudentQueryRow[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const columns: ColumnDef<StudentQueryRow>[] = [
  {
    accessorKey: 'nie',
    header: 'NIE',
    size: 100,
  },
  {
    accessorKey: 'nombre_estudiante',
    header: 'Nombre Estudiante',
    size: 200,
  },
  {
    accessorKey: 'sexo',
    header: 'Sexo',
    size: 70,
  },
  {
    accessorKey: 'edad',
    header: 'Edad',
    size: 60,
    cell: ({ row }) => row.original.edad ?? 'N/A',
  },
  {
    accessorKey: 'grado',
    header: 'Grado',
    size: 100,
  },
  {
    accessorKey: 'tipo_de_camisa',
    header: 'Tipo de Camisa',
    size: 120,
  },
  {
    accessorKey: 'camisa',
    header: 'Camisa',
    size: 80,
  },
  {
    accessorKey: 't_pantalon_falda_short',
    header: 'T. Pantalón/Falda Short',
    size: 150,
  },
  {
    accessorKey: 'pantalon_falda',
    header: 'Pantalón/Falda',
    size: 120,
  },
  {
    accessorKey: 'zapato',
    header: 'Zapato',
    size: 80,
  },
];

export const StudentsGrid = memo(function StudentsGrid({
  students,
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
}: StudentsGridProps) {
  const totalPages = useMemo(() => Math.ceil(totalCount / pageSize), [totalCount, pageSize]);
  const hasNextPage = useMemo(() => currentPage < totalPages, [currentPage, totalPages]);
  const hasPrevPage = useMemo(() => currentPage > 1, [currentPage]);

  const table = useReactTable({
    data: students,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  return (
    <div className="space-y-4">
      {/* Results summary */}
      <div className="text-sm text-muted-foreground">
        Mostrando {students.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
        {Math.min(currentPage * pageSize, totalCount)} de {totalCount} estudiantes
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-sm font-medium"
                      style={{ width: header.getSize() }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map(row => (
                  <tr key={row.id} className="border-t hover:bg-muted/50">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 text-sm">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No se encontraron estudiantes. Ajusta los filtros y busca nuevamente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Página {currentPage} de {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={!hasPrevPage}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={!hasNextPage}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
