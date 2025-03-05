import { defineConfig } from 'tsup';
import { copyFile } from 'fs/promises'

import { createPackageJson, createDockerfile, getDependencies } from '../../devops/scripts';

import { name, version } from './package.json';

export default defineConfig(async () => {
  const { dependencies } = await getDependencies(name);

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
      createPackageJson(`dist`, name, version, dependencies);
      createDockerfile(`dist`);
      await copyFile(`docker-compose.yml`, `dist/docker-compose.yml`);
    },
  };
});
