const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!supabaseUrl) return [];

    return [
      {
        source: "/supabase/:path*",
        destination: `${supabaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
