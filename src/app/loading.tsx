export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-primary"></div>
        <p className="mt-4 text-muted-foreground">Cargando...</p>
      </div>
    </div>
  );
}
