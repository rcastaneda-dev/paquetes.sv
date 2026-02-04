import { Card, CardContent, CardHeader } from '@/components/ui/Card';

export default function BulkLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Reportes Masivos</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <div className="h-8 w-48 animate-pulse rounded bg-muted"></div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="h-10 w-40 animate-pulse rounded bg-muted"></div>
              <div className="h-10 w-40 animate-pulse rounded bg-muted"></div>
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded border bg-muted/50"></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
