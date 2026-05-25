import type { ZodIssue } from 'zod';
import { envSchema } from './schemas.js';
import type { EnvSchema } from './schemas.js';

/** Load and validate environment variables. No hardcoded URLs in production. */
function loadEnv(): EnvSchema {
  const isProduction = process.env.NODE_ENV === 'production';

  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY,
    AFRICAS_TALKING_API_KEY: process.env.AFRICAS_TALKING_API_KEY,
    AFRICAS_TALKING_USERNAME: process.env.AFRICAS_TALKING_USERNAME,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    API_URL: process.env.API_URL ?? (isProduction ? undefined : 'http://localhost:4000'),
    FRONTEND_URL: process.env.FRONTEND_URL ?? (isProduction ? undefined : 'http://localhost:3000'),
    // A2b-3 wire #6 — privacy posture. Default-on means the kernel ships
    // with the extended-PII scrub active; ops opts OUT for dev, not IN
    // for prod.
    BORJIE_PII_EXTENDED: process.env.BORJIE_PII_EXTENDED,
    USER_HASH_SALT: process.env.USER_HASH_SALT,
    AWS_REGION_BY_TENANT_OVERRIDE: process.env.AWS_REGION_BY_TENANT_OVERRIDE,
  };

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i: ZodIssue) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  const data = result.data;

  if (isProduction) {
    if (!data.API_URL || !data.FRONTEND_URL) {
      throw new Error(
        'Production requires API_URL and FRONTEND_URL to be set in the environment. No hardcoded defaults.'
      );
    }
  }

  return {
    ...data,
    API_URL: data.API_URL ?? 'http://localhost:4000',
    FRONTEND_URL: data.FRONTEND_URL ?? 'http://localhost:3000',
  } as EnvSchema;
}

/** Validated config singleton */
let _config: EnvSchema | null = null;

/**
 * Get the validated config. Throws if env validation fails.
 * Call early in app bootstrap (e.g. main.ts).
 */
export function getConfig(): EnvSchema {
  if (!_config) {
    _config = loadEnv();
  }
  return _config;
}

/**
 * Database configuration
 */
export const database = () => ({
  url: getConfig().DATABASE_URL,
});

/**
 * Redis configuration
 */
export const redis = () => ({
  url: getConfig().REDIS_URL,
});

/**
 * Auth configuration
 */
export const auth = () => ({
  jwtSecret: getConfig().JWT_SECRET,
  jwtExpiresIn: getConfig().JWT_EXPIRES_IN,
  clerkSecretKey: getConfig().CLERK_SECRET_KEY,
});

/**
 * Payments configuration
 */
export const payments = () => ({
  mpesa: {
    consumerKey: getConfig().MPESA_CONSUMER_KEY,
    consumerSecret: getConfig().MPESA_CONSUMER_SECRET,
    passkey: getConfig().MPESA_PASSKEY,
    shortcode: getConfig().MPESA_SHORTCODE,
  },
  stripe: {
    secretKey: getConfig().STRIPE_SECRET_KEY,
  },
  flutterwave: {
    secretKey: getConfig().FLUTTERWAVE_SECRET_KEY,
  },
});

/**
 * Notifications configuration
 */
export const notifications = () => ({
  africastalking: {
    apiKey: getConfig().AFRICAS_TALKING_API_KEY,
    username: getConfig().AFRICAS_TALKING_USERNAME,
  },
  sendgrid: {
    apiKey: getConfig().SENDGRID_API_KEY,
  },
  firebase: {
    projectId: getConfig().FIREBASE_PROJECT_ID,
  },
});

/**
 * Storage configuration
 */
export const storage = () => ({
  aws: {
    accessKeyId: getConfig().AWS_ACCESS_KEY_ID,
    secretAccessKey: getConfig().AWS_SECRET_ACCESS_KEY,
    s3Bucket: getConfig().AWS_S3_BUCKET,
  },
});

/**
 * AI configuration
 */
export const ai = () => ({
  openaiApiKey: getConfig().OPENAI_API_KEY,
});

/**
 * URLs configuration
 */
export const urls = () => ({
  apiUrl: getConfig().API_URL,
  frontendUrl: getConfig().FRONTEND_URL,
});

/**
 * Privacy configuration (A2b-3 wire #6)
 */
export const privacy = () => ({
  piiExtended: getConfig().BORJIE_PII_EXTENDED === '1',
  userHashSalt: getConfig().USER_HASH_SALT,
  awsRegionByTenantOverride: getConfig().AWS_REGION_BY_TENANT_OVERRIDE,
});

/** Re-export schemas for consumers that need validation */
export {
  envSchema,
  databaseSchema,
  redisSchema,
  authSchema,
  paymentsSchema,
  notificationsSchema,
  storageSchema,
  aiSchema,
  urlsSchema,
  privacySchema,
} from './schemas.js';
export type { EnvSchema } from './schemas.js';

/** Centralized application constants (thresholds, timeouts, dev defaults). */
export * from './constants.js';
