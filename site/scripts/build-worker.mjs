import { build } from 'esbuild';
await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', minify: true, loader: { '.html': 'text' } });
