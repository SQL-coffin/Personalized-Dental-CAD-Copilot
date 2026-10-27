/**
 * Which Runtime the composition root connects to. Set at build time:
 *   VITE_RUNTIME_TRANSPORT=simulated (default) | http
 *   VITE_RUNTIME_URL=https://…            (http only)
 * The http transport is a placeholder until a Runtime service exists.
 */
export type RuntimeTransport = 'simulated' | 'http';

export interface RuntimeConfig {
  transport: RuntimeTransport;
  baseUrl: string;
}

export function readRuntimeConfig(env: Record<string, string | undefined> = import.meta.env): RuntimeConfig {
  const transport = env.VITE_RUNTIME_TRANSPORT === 'http' ? 'http' : 'simulated';
  return { transport, baseUrl: env.VITE_RUNTIME_URL ?? 'http://localhost:8787' };
}
