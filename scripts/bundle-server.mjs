/**
 * Bundles the Fastify server into a single ESM file for the packaged Electron
 * app. Equivalent to the previous one-line `esbuild ...` script, but adds an
 * ESM banner that defines `require`, `__filename`, and `__dirname` — without
 * those, CJS deps like `avvio` (used by Fastify) blow up at runtime with:
 *
 *   Error: Dynamic require of "node:events" is not supported
 *
 * Run via:  npm run electron:bundle-server
 */
import { build } from 'esbuild'

const banner = `
import { createRequire as __cjsCreateRequire } from 'node:module';
import { fileURLToPath as __cjsFileURLToPath } from 'node:url';
import { dirname as __cjsDirname } from 'node:path';
const require = __cjsCreateRequire(import.meta.url);
const __filename = __cjsFileURLToPath(import.meta.url);
const __dirname  = __cjsDirname(__filename);
`

await build({
  entryPoints: ['server/src/index.ts'],
  bundle:      true,
  platform:    'node',
  target:      'node18',
  format:      'esm',
  outfile:     'dist-electron/server.mjs',
  external:    ['fsevents'],
  banner:      { js: banner },
  logLevel:    'info',
})
