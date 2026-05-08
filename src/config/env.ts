import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  STRIPE_SECRET_KEY: z.string().optional(),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_ACCESS_TOKEN: z.string().optional(),

  DEFAULT_EMAIL_DOMAINS: z.string().optional().transform((val) =>
    val ? val.split(',').map((d) => d.trim()).filter(Boolean) : []
  ),

  SKIP_SANDBOX_CHECK_STRIPE: z.coerce.boolean().default(false),
  SKIP_SANDBOX_CHECK_HUBSPOT: z.coerce.boolean().default(false),
  SKIP_SANDBOX_CHECK_SHOPIFY: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;
  _env = envSchema.parse(process.env);
  return _env;
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}

export function resetEnv(): void {
  _env = null;
}
