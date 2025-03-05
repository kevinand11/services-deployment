import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execAsync = promisify(exec)

const APP_DIR = '/tmp/management-service'
const COMPOSE_FILE = path.join(APP_DIR, 'docker-compose.yml')

export const loadComposeFile = async () => {
  const content = await fs.readFile(COMPOSE_FILE, 'utf8')
  return yaml.load(content) as any
}

export const saveComposeFile = async (composeData: unknown) => {
  const content = yaml.dump(composeData)
  await fs.writeFile(COMPOSE_FILE, content, 'utf8')
}

export const restartServices = async () => {
  await execAsync(`cd ${APP_DIR} && docker-compose up -d`)
}

export const ensureComposeFileExists = async () => {
  if (existsSync(COMPOSE_FILE)) {
    return
  }
  const clonePath = path.join(process.cwd(), 'docker-compose.yml')

  if (!existsSync(clonePath)) {
    throw new Error('Copy of docker-compose.yml is needed')
  }
  await fs.mkdir(path.dirname(COMPOSE_FILE), { recursive: true })
  await fs.copyFile(clonePath, COMPOSE_FILE)
}