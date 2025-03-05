
export interface ServiceConfig {
  image: string
  port: number
  path: string
  env?: Record<string, string>
}