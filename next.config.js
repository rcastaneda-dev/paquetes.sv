/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * PDFKit loads built-in font metric files at runtime (e.g. Helvetica.afm).
   * In serverless builds, Next output tracing may omit those static files,
   * causing ENOENT at runtime. Force-include them in the server bundle.
   */
  outputFileTracingIncludes: {
    '**/*': ['node_modules/pdfkit/js/data/**'],
  },
  experimental: {
    serverComponentsExternalPackages: ['pdfkit'],
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

module.exports = nextConfig;
