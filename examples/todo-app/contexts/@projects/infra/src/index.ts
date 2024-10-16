import { UUIDGenerator } from '@hex-effect/core';
import { Live as InfraLive, NatsConfig, LibsqlConfig } from '@hex-effect/infra-libsql-nats';
import { Config, Layer } from 'effect';
import { GetAllProjectsLive, SaveProjectLive } from './service.js';
import type { Services } from '@projects/application';

const ConfigLive = Layer.succeed(NatsConfig, {
  config: { servers: Config.string('NATS_SERVER') },
  appNamespace: Config.succeed('Kralf')
}).pipe(
  Layer.merge(Layer.succeed(LibsqlConfig, { config: { url: Config.string('DATABASE_URL') } }))
);

export const Live = InfraLive.pipe(
  Layer.provide(ConfigLive),
  Layer.provideMerge(UUIDGenerator.Default)
);

export const ServiceLive = Layer.mergeAll(
  SaveProjectLive,
  GetAllProjectsLive
) satisfies Layer.Layer<Services.SaveProject | Services.GetAllProjects, unknown, unknown>;
