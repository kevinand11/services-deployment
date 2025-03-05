import fastify from 'fastify'
import { createError } from '@fastify/error'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { exec } from 'child_process'
import { promisify } from 'util'

const app = fastify()

app.setErrorHandler((err, _, reply) => {
  reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.stack })
})

const execAsync = promisify(exec)
const port = Number(process.env.PORT) || 3000

const APP_DIR = '/app'
const COMPOSE_FILE = path.join(APP_DIR, 'docker-compose.yml')

interface ServiceConfig {
  image: string
  domain: string
  port: number
  path: string
  env?: Record<string, string>
}

const loadComposeFile = async () => {
  const content = await fs.readFile(COMPOSE_FILE, 'utf8')
  return yaml.load(content) as any
}

const saveComposeFile = async (composeData: unknown) => {
  const content = yaml.dump(composeData)
  await fs.writeFile(COMPOSE_FILE, content, 'utf8')
}

const restartServices = async () => {
  await execAsync(`cd ${APP_DIR} && docker-compose up -d`)
}

app.get(`/services`, async (req, res) => {
  const composeData = await loadComposeFile()
  const services = Object.keys(composeData.services)
    .filter(name => name !== 'traefik' && name !== 'management')
    .map(name => {
      const service = composeData.services[name]
      const labels = service.labels || []

      const pathRule = labels.find((l: string) => l.includes('traefik.http.routers') && l.includes('.rule='))
      const path = pathRule ?
        pathRule.match(/PathPrefix\(`([^`]+)`\)/) ?
          pathRule.match(/PathPrefix\(`([^`]+)`\)/)[1] :
          '/' :
        '/'

      const portLabel = labels.find((l: string) => l.includes('traefik.http.services') && l.includes('.loadbalancer.server.port='))
      const port = portLabel ?
        parseInt(portLabel.split('=')[1]) :
        (service.environment?.PORT ? parseInt(service.environment.PORT) : null)

      return {
        name,
        image: service.image,
        path,
        port
      }
    })

  res.send(services)
})

app.post<{ Body: ServiceConfig & { name: string } }>(`/services`, async (req, res) => {
  const { name, ...config } = req.body

  if (!name || !config.image || !config.port || !config.path) {
    throw createError('', 'Missing required fields', 400)
  }

  const composeData = await loadComposeFile()

  if (composeData.services[name]) {
    throw createError('', 'Service with this name already exists', 400)
  }

  const domain = config.domain

  composeData.services[name] = {
    image: config.image,
    container_name: name,
    restart: 'unless-stopped',
    environment: {
      NODE_ENV: 'production',
      PORT: config.port.toString(),
      ...(config.env || {})
    },
    labels: [
      'traefik.enable=true',
      `traefik.http.routers.${name}.rule=Host(\`${domain}\`) && PathPrefix(\`${config.path}\`)`,
      `traefik.http.routers.${name}.entrypoints=websecure`,
      `traefik.http.routers.${name}.tls.certresolver=awsresolver`,
      `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
    ],
    networks: ['traefik-net']
  }

  await saveComposeFile(composeData)
  await restartServices()

  res.send({ name, config })
})

app.put<{ Params: { name: string }; Body: Partial<ServiceConfig> }>(`/services/:name`, async (req, res) => {
  const { name } = req.params
  const config = req.body

  const composeData = await loadComposeFile()

  if (!composeData.services[name] || name === 'traefik' || name === 'management') {
    throw createError('', 'Service not found or cannot be modified', 400)
  }

  const service = composeData.services[name]

  if (config.image) {
    service.image = config.image
  }

  if (config.env) {
    service.environment = {
      ...service.environment,
      ...config.env
    }
  }

  if (config.domain) {
    service.domain = config.domain
  }

  if (config.path) {
    const labels = service.labels as string[]
    const ruleIndex = labels.findIndex(l => l.includes('traefik.http.routers') && l.includes('.rule='))

    if (ruleIndex !== -1) {
      labels[ruleIndex] = `traefik.http.routers.${name}.rule=Host(\`${service.domain}\`) && PathPrefix(\`${config.path}\`)`
    }
  }

  if (config.port) {
    service.environment.PORT = config.port.toString()

    const labels = service.labels as string[]
    const portIndex = labels.findIndex(l => l.includes('traefik.http.services') && l.includes('.loadbalancer.server.port='))

    if (portIndex !== -1) {
      labels[portIndex] = `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
    }
  }

  await saveComposeFile(composeData)
  await restartServices()

  res.send({ name, updated: true })
})

app.delete<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
  const { name } = req.params

  const composeData = await loadComposeFile()

  if (!composeData.services[name] || name === 'traefik' || name === 'management') {
    throw createError('', 'Service not found or cannot be deleted', 400)
  }

  delete composeData.services[name]

  await saveComposeFile(composeData)
  await restartServices()

  res.send(true)
})

app.post(`/reload`, async (req, res) => {
  res.send(true)
})

app.listen({ port }, () => {
  console.log(`Management service running on port ${port}`)
})