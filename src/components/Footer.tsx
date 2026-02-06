import Image from 'next/image';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <Image
              src="/goes_logo_2.png"
              alt="Gobierno de El Salvador"
              width={48}
              height={48}
              className="h-12 w-12 object-contain"
            />
            <div className="text-sm text-gray-600">
              <p className="font-semibold">Gobierno de El Salvador</p>
            </div>
          </div>
          <div className="text-center text-sm text-gray-500 sm:text-right">
            <p>© {currentYear} Paquetes Escolares</p>
            <p>El Salvador, Centroamérica</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
