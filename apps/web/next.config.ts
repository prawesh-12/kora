import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// The environment lives at the workspace root, which Next does not look at.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const KORA_PACKAGES = ['@kora/core', '@kora/db', '@kora/tools', '@kora/ai', '@kora/evaluation'];

const dirnameLoader = fileURLToPath(
  new URL('./webpack/import-meta-dirname-loader.cjs', import.meta.url),
);

/**
 * The `@kora/*` packages ship TypeScript source and import each other with `.js`
 * specifiers, which is what `tsc` wants and what a bundler has to be told about.
 * Turbopack has no equivalent of `extensionAlias`, so this app builds on webpack.
 */
const config: NextConfig = {
  agentRules: false,
  transpilePackages: KORA_PACKAGES,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    webpackConfig.module.rules.push({
      test: /[\\/]packages[\\/][^\\/]+[\\/]src[\\/].*\.ts$/,
      use: [{ loader: dirnameLoader }],
    });
    return webpackConfig;
  },
};

export default config;
