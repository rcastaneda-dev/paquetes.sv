import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/Card';

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl space-y-10">
          {/* Heading */}
          <div className="text-center">
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              paquetes.sv
            </h1>
            <p className="mt-3 text-pretty text-lg text-muted-foreground">
              Sistema de gestión de paquetes escolares
            </p>
          </div>

          {/* Two entry-point cards */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Estudiantes card */}
            <Link href="/staging">
              <Card className="h-full transition-colors hover:border-primary">
                <CardContent className="flex flex-col items-center gap-4 px-8 pb-10 pt-12 text-center">
                  <div className="rounded-xl bg-primary/10 p-4 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <h2 className="text-balance text-xl font-semibold">Estudiantes</h2>
                  <p className="text-pretty text-sm text-muted-foreground">
                    Carga datos de estudiantes, genera reportes masivos y descarga PDFs
                    consolidados.
                  </p>
                </CardContent>
              </Card>
            </Link>

            {/* Faltantes card */}
            <Link href="/staging/demand">
              <Card className="h-full transition-colors hover:border-primary">
                <CardContent className="flex flex-col items-center gap-4 px-8 pb-10 pt-12 text-center">
                  <div className="rounded-xl bg-primary/10 p-4 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <path d="M12 11h4" />
                      <path d="M12 16h4" />
                      <path d="M8 11h.01" />
                      <path d="M8 16h.01" />
                    </svg>
                  </div>
                  <h2 className="text-balance text-xl font-semibold">Faltantes</h2>
                  <p className="text-pretty text-sm text-muted-foreground">
                    Carga la base de datos normalizada y descarga comandas, actas de recepción y
                    consolidados.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Secondary link */}
          <div className="text-center">
            <Link
              href="/consulta"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Consulta por escuela
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
