import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execAsync = promisify(exec)

const COMPOSE_FILE = path.join('/tmp/management-service', 'docker-compose.yml')

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
    throw err
  }
}

export const restartServices = async() => {
  await execAsync([
    `cd ${path.dirname(COMPOSE_FILE)}`,
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