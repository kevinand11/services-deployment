
export interface ServiceConfig {
  image: string
  domain: string
  port: number
  path: string
  env?: Record<string, string>
}