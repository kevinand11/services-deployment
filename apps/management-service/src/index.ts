import fastify from 'fastify'
import { createError } from '@fastify/error'
import { ServiceConfig } from './types'
import { loadComposeFile, saveComposeFile, restartServices, ensureComposeFileExists } from './utils'

const app = fastify()

function getError (message: string, status: number) {
  const error = createError('FST_ERR_FAILED_ERROR_SERIALIZATION', message, status)
  return new error()
}

app.setErrorHandler((err, _, reply) => {
  console.error(err)
  reply.status(err.statusCode || 400).send({ error: err.message, details: err.stack })
})

app.addHook('onRequest', async (req) => {
  console.log(JSON.stringify({
    method: req.method,
    url: req.url,
    body: req.body,
    query: req.query
  }, null, 2))
})

async function getServices () {
  const composeData = await loadComposeFile()
  return Object.keys(composeData.services)
    .filter(name => name !== 'traefik')
    .map(name => {
      const service = composeData.services[name]
      const labels = service.labels || []

      const pathRule = labels.find((l: string) => l.includes('traefik.http.routers') && l.includes('.rule='))
      const path = pathRule ?
        pathRule.match(/PathPrefix\(`([^`]+)`\)/) ?
          pathRule.match(/PathPrefix\(`([^`]+)`\)/)[1] :
          '/' :
        '/'

      const domain = pathRule ?
        pathRule.match(/Host\(`([^`]+)`\)/) ?
          pathRule.match(/Host\(`([^`]+)`\)/)[1] :
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
        domain,
        port,
      }
    })
}

app.get(`/services`, async (req, res) => {
  const services = await getServices()
  res.send(services)
})

app.get<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
  const services = await getServices()
  const service = services.find((s) => s.name === req.params.name)
  if (!service) {
    throw getError('Service not found', 404)
  }
  res.send(service)
})

app.post<{ Body: ServiceConfig & { name: string } }>(`/services`, async (req, res) => {
  const { name, ...config } = req.body

  if (!name || !config.image || !config.port || !config.domain) {
    throw getError('Missing required fields', 400)
  }

  const composeData = await loadComposeFile()

  if (composeData.services[name]) {
    throw getError('Service with this name already exists', 400)
  }

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
      `traefik.http.middlewares.${name}-redirect-to-https.redirectscheme.scheme=https`,
      //`traefik.http.middlewares.${name}.stripprefix.prefixes=${config.domain}`,
      `traefik.http.routers.${name}.rule=Host(\`${config.domain}\`)`,
      `traefik.http.routers.${name}.middlewares=${name}-redirect-to-https`,
      //`traefik.http.routers.${name}.middlewares=${name}`,
      `traefik.http.routers.${name}.entrypoints=websecure`,
      `traefik.http.routers.${name}.tls=true`,
      `traefik.http.routers.${name}.tls.certresolver=myresolver`,
      `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
    ],
  }

  await saveComposeFile(composeData)

  res.send({ name, composeData })
})

app.put<{ Params: { name: string }; Body: Partial<ServiceConfig> }>(`/services/:name`, async (req, res) => {
  const { name } = req.params
  const config = req.body

  const composeData = await loadComposeFile()
  const service = composeData.services[name]

  if (!service || name === 'traefik') {
    throw getError('Service not found or cannot be modified', 400)
  }

  if (config.image) {
    service.image = config.image
  }

  if (config.env) {
    service.environment = {
      ...service.environment,
      ...config.env
    }
  }

  const labels = service.labels as string[]

  if (config.domain) {
    const ruleIndex = labels.findIndex(l => l.includes('traefik.http.routers') && l.includes('.rule='))

    if (ruleIndex !== -1) {
      labels[ruleIndex] = `traefik.http.routers.${name}.rule=Host(\`${config.domain}\`)`
    }

    /* const stripprefixIndex = labels.findIndex(l => l.includes('traefik.http.middlewares') && l.includes('.stripprefix'))
    if (stripprefixIndex !== -1) {
      labels[stripprefixIndex] = `traefik.http.middlewares.${name}.stripprefix.prefixes=${config.path}`
    } */
  }

  if (config.port) {
    service.environment.PORT = config.port.toString()
    const portIndex = labels.findIndex(l => l.includes('traefik.http.services') && l.includes('.loadbalancer.server.port='))

    if (portIndex !== -1) {
      labels[portIndex] = `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
    }
  }

  await saveComposeFile(composeData)

  res.send({ name, updated: true })
})

app.delete<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
  const { name } = req.params

  const composeData = await loadComposeFile()

  if (!composeData.services[name] || name === 'traefik') {
    throw getError('Service not found or cannot be deleted', 400)
  }

  delete composeData.services[name]

  await saveComposeFile(composeData)

  res.send(true)
})

app.post(`/reload`, async (req, res) => {
  await restartServices()
  res.send(true)
})

const port = Number(process.env.PORT) || 3000
ensureComposeFileExists().then(async () => {
  await restartServices()
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Management service running on port: ${port}`)
})