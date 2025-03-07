import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { spawn } from 'child_process'
import { existsSync } from 'fs'

const COMPOSE_FILE = path.join('/tmp/management-service', 'docker-compose.yml')

function run(directory: string, command: string) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: directory, shell: true });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${errorOutput.trim()}`));
      } else {
        resolve(output.trim());
      }
    });
  });
}

export const loadComposeFile = async () => {
  const content = await fs.readFile(COMPOSE_FILE, 'utf8')
  return yaml.load(content) as any
}

export const saveComposeFile = async (composeData: unknown) => {
  const oldValue = await loadComposeFile()
  await fs.writeFile(COMPOSE_FILE, yaml.dump(composeData), 'utf8')
  try {
    await restartServices()
  } catch (err) {
    await fs.writeFile(COMPOSE_FILE, yaml.dump(oldValue), 'utf8')
    await restartServices().catch(() => {})
    throw err
  }
}

export const restartServices = async() => {
  await run(path.dirname(COMPOSE_FILE), [
    `docker-compose pull`,
    `docker-compose build`,
    `docker-compose down --remove-orphans`,
    `docker-compose up -d`
  ].join(' && '))
}

export const ensureComposeFileExists = async () => {
  await fs.mkdir(path.dirname(COMPOSE_FILE), { recursive: true })

  if (existsSync(COMPOSE_FILE)) {
    return
  }

  const clone = path.join(process.cwd(), 'docker-compose.yml')
  if (!existsSync(clone)) {
    throw new Error('docker-compose.yml is needed')
  }

  await fs.copyFile(clone, COMPOSE_FILE, fs.constants.COPYFILE_EXCL)
}