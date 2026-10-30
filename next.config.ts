import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/plugin": ["./plugin/**/*"] },
};
export default config;
