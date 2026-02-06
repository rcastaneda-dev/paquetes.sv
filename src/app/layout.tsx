import type { Metadata } from 'next';
import './globals.css';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Paquetes.sv - Sistema de Tallas Escolares',
  description: 'Sistema de gestión de tallas de uniformes escolares',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="flex min-h-full flex-col">
        <main className="flex flex-1 flex-col">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
