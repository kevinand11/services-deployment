import fastify from 'fastify'
import { createError } from '@fastify/error'
import { ServiceConfig } from './types'
import { loadComposeFile, saveComposeFile, restartServices, ensureComposeFileExists } from './utils'

const app = fastify()

app.setErrorHandler((err, _, reply) => {
  reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.stack })
})

app.addHook('onRequest', (req) => {
  console.log(req.url, req.method)
})

const port = Number(process.env.PORT) || 3000

app.register((inst, _, done) => {
  inst.get(`/services`, async (req, res) => {
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

  inst.post<{ Body: ServiceConfig & { name: string } }>(`/services`, async (req, res) => {
    const { name, ...config } = req.body

    if (!name || !config.image || !config.port || !config.path) {
      throw createError('ERROR_CODE', 'Missing required fields', 400)
    }

    const composeData = await loadComposeFile()

    if (composeData.services[name]) {
      throw createError('ERROR_CODE', 'Service with this name already exists', 400)
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
        `traefik.http.routers.${name}.rule=PathPrefix(\`${config.path}\`)${config.domain ? ` && Host(\`${config.domain}\`)` : ''}`,
        `traefik.http.routers.${name}.entrypoints=websecure`,
        `traefik.http.routers.${name}.tls.certresolver=awsresolver`,
        `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
      ],
      networks: ['traefik-net']
    }

    await saveComposeFile(composeData)
    // await restartServices()

    res.send({ name, composeData })
  })

  inst.put<{ Params: { name: string }; Body: ServiceConfig }>(`/services/:name`, async (req, res) => {
    const { name } = req.params
    const config = req.body

    const composeData = await loadComposeFile()

    if (!composeData.services[name] || name === 'traefik' || name === 'management') {
      throw createError('ERROR_CODE', 'Service not found or cannot be modified', 400)
    }

    const service = composeData.services[name]

    service.image = config.image
    service.environment = {
      ...service.environment,
      ...config.env
    }

    const labels = service.labels as string[]
    const ruleIndex = labels.findIndex(l => l.includes('traefik.http.routers') && l.includes('.rule='))

    if (ruleIndex !== -1) {
      labels[ruleIndex] = `traefik.http.routers.${name}.rule=PathPrefix(\`${config.path}\`)${config.domain ? ` && Host(\`${config.domain}\`)` : ''}`
    }

    service.environment.PORT = config.port.toString()
    const portIndex = labels.findIndex(l => l.includes('traefik.http.services') && l.includes('.loadbalancer.server.port='))

    if (portIndex !== -1) {
      labels[portIndex] = `traefik.http.services.${name}.loadbalancer.server.port=${config.port}`
    }

    await saveComposeFile(composeData)
    await restartServices()

    res.send({ name, updated: true })
  })

  inst.delete<{ Params: { name: string } }>(`/services/:name`, async (req, res) => {
    const { name } = req.params

    const composeData = await loadComposeFile()

    if (!composeData.services[name] || name === 'traefik' || name === 'management') {
      throw createError('ERROR_CODE', 'Service not found or cannot be deleted', 400)
    }

    delete composeData.services[name]

    await saveComposeFile(composeData)
    await restartServices()

    res.send(true)
  })

  inst.post(`/reload`, async (req, res) => {
    res.send(true)
  })

  done()
}, { prefix: process.env.BASE_PATH || '/management' })

ensureComposeFileExists().then(async () => {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Management service running on port ${port}`)
})