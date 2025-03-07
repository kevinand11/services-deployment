
export interface ServiceConfig {
  image: string
  port: number
  domain?: string
  path?: string
  env?: Record<string, string>
}

export interface DockerCompose {
  services: Record<string, ServiceDefinition>;
  networks?: Record<string, NetworkDefinition>;
  volumes?: Record<string, VolumeDefinition>;
  configs?: Record<string, ConfigDefinition>;
  secrets?: Record<string, SecretDefinition>;
}

export interface ServiceDefinition {
  image: string;
  container_name: string;
  environment: Record<string, string>;
  labels: ServiceLabels;
  restart: "no" | "always" | "on-failure" | "unless-stopped";
  build?: BuildDefinition;
  command?: string | string[];
  env_file?: string | string[];
  ports?: string[];
  volumes?: string[];
  networks?: string[];
  depends_on?: string[] | Record<string, DependsOnCondition>;
  logging?: LoggingDefinition;
  healthcheck?: HealthCheckDefinition;
  entrypoint?: string | string[];
}

type ServiceLabelKeys =
  | 'traefik.enable'
  | `traefik.http.middlewares.${string}-redirect-to-https.redirectscheme.scheme`
  | `traefik.http.middlewares.${string}.stripprefix.prefixes`
  | `traefik.http.routers.${string}.rule`
  | `traefik.http.routers.${string}.middlewares`
  | `traefik.http.routers.${string}.entrypoints`
  | `traefik.http.routers.${string}.tls`
  | `traefik.http.routers.${string}.tls.certresolver`
  | `traefik.http.services.${string}.loadbalancer.server.port`
  | `metadata.domain`
  | `metadata.path`
  | `metadata.port`

export interface ServiceLabels extends Record<ServiceLabelKeys, string | undefined> { }

export interface BuildDefinition {
  context: string;
  dockerfile?: string;
  args?: Record<string, string>;
  target?: string;
  cache_from?: string[];
}

export interface NetworkDefinition {
  driver?: string;
  external?: boolean;
  name?: string;
}

export interface VolumeDefinition {
  driver?: string;
  external?: boolean;
  name?: string;
}

export interface ConfigDefinition {
  file: string;
}

export interface SecretDefinition {
  file: string;
}

export interface LoggingDefinition {
  driver?: string;
  options?: Record<string, string>;
}

export interface HealthCheckDefinition {
  test: string | string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
}

export interface DependsOnCondition {
  condition: "service_started" | "service_healthy" | "service_completed_successfully";
}
