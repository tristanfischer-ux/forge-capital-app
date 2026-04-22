import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // officeparser lazy-loads `file-type` via dynamic import. Next's
  // server bundler can't statically trace it, so on Vercel the function
  // boots and then explodes on PDF/PPTX parse with
  //   Cannot find package 'file-type' imported from /var/task/.next/...
  // Mark the whole package external so Vercel installs it to node_modules
  // and lets officeparser resolve its peer at runtime.
  serverExternalPackages: ["officeparser"],
};

export default nextConfig;
