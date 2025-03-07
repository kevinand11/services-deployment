import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { DockerCompose, ServiceDefinition } from './types'

const COMPOSE_FILE = path.join('/tmp/management-service', 'docker-compose.yml')
const reserved = ['traefik'].reduce<Record<string, true>>((acc, cur) => ({ ...acc, [cur]: true }), {})

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

const loadComposeFile = async () => {
  const content = await fs.readFile(COMPOSE_FILE, 'utf8')
  return yaml.load(content) as DockerCompose
}

const saveComposeFile = async (composeData: DockerCompose) => {
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

export const restartServices = async () => {
  await fs.mkdir(path.dirname(COMPOSE_FILE), { recursive: true })

  if (!existsSync(COMPOSE_FILE)) {
    const clone = path.join(process.cwd(), 'docker-compose.yml')
    if (!existsSync(clone)) {
      throw new Error('docker-compose.yml is needed')
    }

    await fs.copyFile(clone, COMPOSE_FILE, fs.constants.COPYFILE_EXCL)
  }

  await run(path.dirname(COMPOSE_FILE), [
    `docker-compose pull`,
    `docker-compose build`,
    `docker-compose down --remove-orphans`,
    `docker-compose up -d`
  ].join(' && '))
}


export async function getServices () {
  const composeData = await loadComposeFile()
  return Object.keys(composeData.services)
    .filter(name => !reserved[name])
    .map((name) => composeData.services[name])
}

export async function getService (name: string) {
  const services = await getServices()
  return services.find((s) => s.labels['metadata.name'] === name)
}

export async function saveService (name: string, service: ServiceDefinition | undefined) {
  // TODO: need to validate unique domain-path combo
  if (reserved[name]) {
    throw new Error(`the service name '${name}' is reserved and cannot be modified`)
  }
  const composeData = await loadComposeFile()
  const existing = composeData.services[name]
  if (service) {
    composeData.services[name] = service
  } else {
    delete composeData.services[name]
  }
  await saveComposeFile(composeData)
  return service || existing
}