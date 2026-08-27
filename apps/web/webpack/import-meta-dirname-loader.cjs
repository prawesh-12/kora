const { dirname } = require('node:path');

/**
 * The `@kora/*` packages resolve config files relative to `import.meta.dirname`.
 * Webpack compiles them to CommonJS, where that expression evaluates to
 * `undefined`, so it is replaced with the real source directory at build time.
 */
module.exports = function importMetaDirnameLoader(source) {
  if (!source.includes('import.meta.dirname')) return source;
  return source.replaceAll('import.meta.dirname', JSON.stringify(dirname(this.resourcePath)));
};
