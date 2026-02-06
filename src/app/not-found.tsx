import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>404 - Página no encontrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            La página que estás buscando no existe o ha sido movida.
          </p>
          <Link href="/">
            <Button className="w-full">Volver al inicio</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
