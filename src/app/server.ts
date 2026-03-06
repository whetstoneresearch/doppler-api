import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { fileURLToPath } from 'node:url';

import { loadConfig, type AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { MetricsRegistry } from '../core/metrics';
import authPlugin from './plugins/auth';
import errorHandlerPlugin from './plugins/error-handler';
import requestLoggerPlugin from './plugins/request-logger';
import { ChainRegistry } from '../infra/chain/registry';
import { DopplerSdkRegistry } from '../infra/doppler/sdk-client';
import { createIdempotencyStore, type IdempotencyStore } from '../infra/idempotency/store';
import { TxSubmitter } from '../infra/tx/submitter';
import { PricingService } from '../modules/pricing/service';
import { LaunchService } from '../modules/launches/service';
import { StatusService } from '../modules/status/service';
import { registerCreateLaunchRoute } from './routes/launches.post';
import { registerCreateMulticurveAliasRoute } from './routes/launches-multicurve.post';
import { registerCreateStaticAliasRoute } from './routes/launches-static.post';
import { registerCreateDynamicAliasRoute } from './routes/launches-dynamic.post';
import { registerLaunchStatusRoute } from './routes/launches-status.get';
import { registerHealthRoute } from './routes/health.get';
import { registerReadyRoute } from './routes/ready.get';
import { registerCapabilitiesRoute } from './routes/capabilities.get';
import { registerMetricsRoute } from './routes/metrics.get';

export interface AppServices {
  config: AppConfig;
  metrics: MetricsRegistry;
  chainRegistry: ChainRegistry;
  sdkRegistry: DopplerSdkRegistry;
  redisClient?: Redis;
  pricingService: PricingService;
  launchService: LaunchService;
  statusService: StatusService;
  txSubmitter: TxSubmitter;
  idempotencyStore: IdempotencyStore;
}

const usesRedis = (config: AppConfig): boolean =>
  config.deploymentMode === 'shared' || config.idempotency.backend === 'redis';

const createRedisClient = (config: AppConfig): Redis | undefined => {
  if (!usesRedis(config)) {
    return undefined;
  }

  if (!config.redis.url) {
    throw new AppError(
      500,
      'MISSING_ENV',
      'REDIS_URL is required when Redis-backed state is enabled',
    );
  }

  return new Redis(config.redis.url, {
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
  });
};

const normalizeHeader = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0] || undefined;
  }
  return value || undefined;
};

const routeAuthDisabled = (request: any): boolean => {
  const routeConfig = (request.routeOptions?.config ?? request.routeConfig) as
    | { auth?: boolean }
    | undefined;
  return routeConfig?.auth === false;
};

export const buildServices = (config: AppConfig): AppServices => {
  const metrics = new MetricsRegistry();
  const chainRegistry = new ChainRegistry(config);
  const sdkRegistry = new DopplerSdkRegistry(chainRegistry.list());
  const txSubmitter = new TxSubmitter();
  const redisClient = createRedisClient(config);
  const idempotencyStore = createIdempotencyStore({
    enabled: config.idempotency.enabled,
    backend: config.idempotency.backend,
    ttlMs: config.idempotency.ttlMs,
    path: config.idempotency.storePath,
    redis: redisClient,
    redisKeyPrefix: config.redis.keyPrefix,
    redisLockTtlMs: config.idempotency.redisLockTtlMs,
    redisLockRefreshMs: config.idempotency.redisLockRefreshMs,
  });
  const pricingService = new PricingService(config);
  const launchService = new LaunchService({
    chainRegistry,
    sdkRegistry,
    pricingService,
    txSubmitter,
    idempotencyStore,
    requireIdempotencyKey: config.idempotency.requireKey,
  });
  const statusService = new StatusService({ chainRegistry, sdkRegistry });

  return {
    config,
    metrics,
    chainRegistry,
    sdkRegistry,
    redisClient,
    pricingService,
    launchService,
    statusService,
    txSubmitter,
    idempotencyStore,
  };
};

export const buildServer = async (services?: AppServices) => {
  const resolvedServices = services ?? buildServices(loadConfig());
  const logger = createLogger(resolvedServices.config.logLevel);
  const usesRedisRateLimit = resolvedServices.config.deploymentMode === 'shared';
  const allowedApiKeys = new Set(resolvedServices.config.apiKeys);

  if (usesRedisRateLimit && !resolvedServices.redisClient) {
    throw new AppError(500, 'MISSING_ENV', 'Shared deployments require Redis-backed rate limiting');
  }

  if (usesRedisRateLimit) {
    try {
      await resolvedServices.redisClient?.ping();
    } catch (error) {
      throw new AppError(
        500,
        'REDIS_UNAVAILABLE',
        'Shared deployments require reachable Redis at startup',
        error,
      );
    }
  }

  const app = Fastify({ loggerInstance: logger });

  await app.register(sensible);
  await app.register(cors, {
    origin:
      resolvedServices.config.corsOrigins.length > 0 ? resolvedServices.config.corsOrigins : false,
  });
  const rateLimitOptions: Record<string, unknown> = {
    max: resolvedServices.config.rateLimit.max,
    timeWindow: resolvedServices.config.rateLimit.timeWindowMs,
    keyGenerator: (request: any) => {
      if (routeAuthDisabled(request)) {
        return `ip:${request.ip}`;
      }

      const apiKey = normalizeHeader(request.headers['x-api-key']);
      if (apiKey && allowedApiKeys.has(apiKey)) {
        return `api-key:${apiKey}`;
      }

      return `ip:${request.ip}`;
    },
  };

  if (usesRedisRateLimit) {
    rateLimitOptions.redis = resolvedServices.redisClient;
    rateLimitOptions.nameSpace = `${resolvedServices.config.redis.keyPrefix}:rate-limit:`;
  }

  await app.register(rateLimit, rateLimitOptions);

  if (resolvedServices.redisClient) {
    app.addHook('onClose', async () => {
      try {
        await resolvedServices.redisClient?.quit();
      } catch {
        resolvedServices.redisClient?.disconnect();
      }
    });
  }

  await app.register(errorHandlerPlugin);
  await app.register(requestLoggerPlugin, { metrics: resolvedServices.metrics });
  await app.register(authPlugin, { apiKeys: resolvedServices.config.apiKeys });

  await registerHealthRoute(app);
  await registerReadyRoute(
    app,
    resolvedServices.chainRegistry,
    resolvedServices.config.readyRpcTimeoutMs,
  );
  await registerCapabilitiesRoute(
    app,
    resolvedServices.chainRegistry,
    resolvedServices.pricingService,
  );
  await registerMetricsRoute(app, resolvedServices.metrics);
  await registerCreateLaunchRoute(app, resolvedServices.launchService);
  await registerCreateMulticurveAliasRoute(app, resolvedServices.launchService);
  await registerCreateStaticAliasRoute(app, resolvedServices.launchService);
  await registerCreateDynamicAliasRoute(app, resolvedServices.launchService);
  await registerLaunchStatusRoute(app, resolvedServices.statusService);

  return app;
};

const start = async () => {
  const config = loadConfig();
  const services = buildServices(config);
  const app = await buildServer(services);

  await app.listen({ host: '0.0.0.0', port: config.port });
};

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
