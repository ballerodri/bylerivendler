import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    // Las fotos de la ficha se suben por server action. Comprimidas en el
    // navegador quedan en ~0,5–1,5 MB, pero el default de 1 MB no dejaba
    // margen (y una foto que no se pudo comprimir viaja original). 4 MB es
    // el techo práctico: el cuerpo de una función en Vercel corta en ~4,5 MB.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
