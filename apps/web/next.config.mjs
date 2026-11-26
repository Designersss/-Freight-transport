/** @type {import("next").NextConfig} */
const config = {
  transpilePackages: ["@freight/ui", "@freight/i18n"],
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/", destination: "/ru", permanent: false }];
  },
};

export default config;
