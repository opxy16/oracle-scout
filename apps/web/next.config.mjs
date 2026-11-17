import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: join(here, "..", ".."),
  transpilePackages: ["@oracle-scout/ledger", "@oracle-scout/concordium"],
  serverExternalPackages: ["@concordium/web-sdk", "@x402/concordium", "@grpc/grpc-js"],
  webpack(config) {
    // workspace packages import "./x.js" from TypeScript sources
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async headers() {
    return [
      { source: "/.well-known/agent-card.json", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=300" }] },
      { source: "/api/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Access-Control-Allow-Headers", value: "content-type, payment-signature, mcp-session-id, mcp-protocol-version" }, { key: "Access-Control-Expose-Headers", value: "PAYMENT-REQUIRED, PAYMENT-RESPONSE" }] },
    ];
  },
};
export default nextConfig;
