import { defineConfig } from 'tsup';
import { copyFile } from 'fs/promises'

import { dependencies } from './package.json';

export default defineConfig(async () => {
  return {
    entry: {
      index: 'src/index.ts',
    },
    //format: ['cjs'],
    outDir: 'dist',
    target: 'node20',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    external: Object.keys(dependencies),
    async onSuccess() {
      await copyFile(`package.json`, `dist/package.json`);
      await copyFile(`Dockerfile`, `dist/Dockerfile`);
      await copyFile(`docker-compose.yml`, `dist/docker-compose.yml`);
    },
  };
});
