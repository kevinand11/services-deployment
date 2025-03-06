
export interface ServiceConfig {
  image: string
  port: number
  domain: string
  env?: Record<string, string>
}