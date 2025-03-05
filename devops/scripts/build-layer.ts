import { execSync } from 'child_process';
import { resolve } from 'path';

import { getDependencies } from './generate-package-json';
import { createPackageJson } from './utils';

async function exec(cwd: string, cmd: string) {
  return execSync(cmd, { cwd, stdio: 'inherit' });
}

export async function buildLayer(projectName: string, version: string, dirPath: string) {
  const { dependencies } = await getDependencies(projectName);

  const nonAwsDeps = Object.fromEntries(
    Object.entries(dependencies).filter(([key]) => !key.startsWith('@aws-sdk'))
  );

  const dir = resolve(dirPath);
  const nodeJsDir = resolve(dir, 'nodejs');

  createPackageJson(nodeJsDir, projectName, version, nonAwsDeps);

  await exec(nodeJsDir, 'npm i --omit=dev');
  await exec(nodeJsDir, 'rm -rf node_modules/aws-sdk && rm -rf node_modules/@aws-sdk');
  await exec(dir, 'zip -qq -r ./layer.zip nodejs');
  await exec(dir, 'rm -rf nodejs/node_modules');
}
