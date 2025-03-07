import fastify from 'fastify'
import { createError } from '@fastify/error'
import { ServiceConfig } from './types'
import { restartServices, getServices, getService, saveService } from './utils'
import { URL } from 'url'

const app = fastify()

function getError (message: string, status: number) {
  const error = createError('FST_ERR_FAILED_ERROR_SERIALIZATION', message, status)
  return new error()
}

function buildHostAndPathRule (domain?: string, path?: string) {
  return [
    domain ? `Host(\`${domain}\`)` : undefined,
    path ? `Path(\`${path}\`)` : undefined,
  ].filter(Boolean).join(' && ') || undefined
}

function cleanPath (path: string | undefined) {
  if (!path || typeof path !== 'string') {
    return undefined
  }
  if (!path.startsWith('/')) {
    path = `/${path}`
  }
  if (!path.endsWith('/')) {
    path = `${path}/`
  }
  return path
}

function cleanDomain (domain: string | undefined) {
  if (!domain || typeof domain !== 'string') {
    return undefined
  }
  if (!URL.canParse(`http://${domain}`)) {
    throw getError('invalid domain value passed in', 400)
  }
  return domain
}

function cleanPort<T extends number | undefined> (port: T) {
  if (!port || typeof port !== 'number') {
    return undefined as T
  }
  if (port > 0 && port < 65535) {
    return port
  }
  throw getError('port must be in a valid range of 0>port<65535', 400)
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

app.get(`/services`, async (req, res) => {
  const services = await getServices()
  res.send(services)
})

app.get<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
  const service = await getService(req.params.name)
  if (!service) {
    throw getError('Service not found', 404)
  }
  res.send(service)
})

app.post<{ Body: ServiceConfig & { name: string } }>(`/services`, async (req, res) => {
  const { name, ...config } = req.body
  config.port = cleanPort(config.port)
  config.domain = cleanDomain(config.domain)
  config.path = cleanPath(config.path)

  if (!name || !config.image || !config.port) {
    throw getError('Missing required fields: name, image, port', 404)
  }

  const existing = await getService(name)
  if (existing) {
    throw getError('Service with this name already exists', 400)
  }

  const service = await saveService(name, {
    image: config.image,
    container_name: name,
    restart: 'unless-stopped',
    environment: {
      NODE_ENV: 'production',
      PORT: config.port.toString(),
      ...(config.env || {})
    },
    labels: {
      ['traefik.enable']: 'true',
      [`traefik.http.middlewares.${name}-redirect-to-https.redirectscheme.scheme`]: 'https',
      [`traefik.http.middlewares.${name}-strip-prefix.stripprefix.prefixes`]: config.path,
      [`traefik.http.routers.${name}.middlewares`]: [`${name}-redirect-to-https`, config.path ? `${name}-strip-prefix` : undefined].filter(Boolean).join(', '),
      [`traefik.http.routers.${name}.tls`]: 'true',
      [`traefik.http.routers.${name}.tls.certresolver`]: 'myresolver',
      [`traefik.http.routers.${name}.rule`]: buildHostAndPathRule(config.domain, config.path),
      [`traefik.http.services.${name}.loadbalancer.server.port`]: `${config.port}`,
      [`metadata.domain`]: config.domain,
      [`metadata.path`]: config.path,
      [`metadata.port`]: `${config.port}`,
    }
  })
  res.send(service)
})

app.put<{ Params: { name: string }; Body: Partial<ServiceConfig> }>(`/services/:name`, async (req, res) => {
  const { name } = req.params
  const config = req.body
  config.port = cleanPort(config.port)
  config.domain = cleanDomain(config.domain)
  config.path = cleanPath(config.path)

  const service = await getService(name)

  if (!service) {
    throw getError('Service not found', 404)
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

  if (config.port) {
    service.environment.PORT = `${config.port}`
    service.labels[`metadata.port`] = `${config.port}`
    service.labels[`traefik.http.services.${name}.loadbalancer.server.port`] = `${config.port}`
  }

  const domain = config.domain ?? service.labels[`metadata.domain`]
  const path = config.path ?? service.labels[`metadata.path`]

  service.labels[`metadata.domain`] = domain
  service.labels[`metadata.path`] = path
  service.labels[`traefik.http.routers.${name}.rule`] = buildHostAndPathRule(domain, path)

  if (path) {
    service.labels[`traefik.http.routers.${name}.middlewares`] = `${name}-redirect-to-https, ${name}-strip-prefix`
    service.labels[`traefik.http.middlewares.${name}-strip-prefix.stripprefix.prefixes`] = path
  } else {
    service.labels[`traefik.http.routers.${name}.middlewares`] = `${name}-redirect-to-https`
  }

  const updatedService =  await saveService(req.params.name, service)
  res.send(updatedService)
})

app.delete<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
  const { name } = req.params
  const service = await getService(name)

  if (!service) {
    throw getError('Service not found', 404)
  }
  await saveService(name, undefined)
  res.send(true)
})

app.post(`/reload`, async (req, res) => {
  await restartServices()
  res.send(true)
})

const port = Number(process.env.PORT) || 3000
restartServices().then(async () => {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Management service running on port: ${port}`)
})