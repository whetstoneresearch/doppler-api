import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';

import { loadConfig, type AppConfig } from '../core/config';
import { createLogger } from '../core/logger';
import { MetricsRegistry } from '../core/metrics';
import authPlugin from './plugins/auth';
import errorHandlerPlugin from './plugins/error-handler';
import requestLoggerPlugin from './plugins/request-logger';
import { ChainRegistry } from '../infra/chain/registry';
import { DopplerSdkRegistry } from '../infra/doppler/sdk-client';
import { IdempotencyStore } from '../infra/idempotency/store';
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
  pricingService: PricingService;
  launchService: LaunchService;
  statusService: StatusService;
  txSubmitter: TxSubmitter;
  idempotencyStore: IdempotencyStore;
}

export const buildServices = (config: AppConfig): AppServices => {
  const metrics = new MetricsRegistry();
  const chainRegistry = new ChainRegistry(config);
  const sdkRegistry = new DopplerSdkRegistry(chainRegistry.list());
  const txSubmitter = new TxSubmitter();
  const idempotencyStore = new IdempotencyStore({
    enabled: config.idempotency.enabled,
    ttlMs: config.idempotency.ttlMs,
    path: config.idempotency.storePath,
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

  const app = Fastify({ loggerInstance: logger });

  await app.register(sensible);
  await app.register(cors, {
    origin:
      resolvedServices.config.corsOrigins.length > 0 ? resolvedServices.config.corsOrigins : false,
  });
  await app.register(rateLimit, {
    max: resolvedServices.config.rateLimit.max,
    timeWindow: resolvedServices.config.rateLimit.timeWindowMs,
    keyGenerator: (request) => {
      const key = request.headers['x-api-key'];
      return Array.isArray(key) ? key[0] || request.ip : key || request.ip;
    },
  });

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
