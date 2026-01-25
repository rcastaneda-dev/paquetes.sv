import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paquetes SV - Sistema de Tallas Escolares',
  description: 'Sistema de gestión de tallas de uniformes escolares',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
