import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@kora/core', '@kora/db', '@kora/tools', '@kora/ai', '@kora/evaluation'],
};

export default config;
