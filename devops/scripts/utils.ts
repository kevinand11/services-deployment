import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export function createPackageJson(
  dir: string,
  packageName: string,
  version: string,
  dependencies: Record<string, string>,
  extra?: Record<string, unknown>
) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    resolve(dir, 'package.json'),
    JSON.stringify(
      {
        name: `${packageName}-compiled`,
        version,
        dependencies,
        ...extra,
      },
      null,
      2
    )
  );
}

export function createDockerfile(dir: string) {
  copyFileSync(resolve(__dirname, './assets/Dockerfile'), resolve(dir, 'Dockerfile'));
}
