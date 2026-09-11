import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native Moss bindings must stay external to the Next.js bundle.
  serverExternalPackages: ["@moss-js/moss", "@moss-js/moss-core"],
};

export default nextConfig;
