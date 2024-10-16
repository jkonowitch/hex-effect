import { Live as InfraLive, NatsConfig, LibsqlConfig } from '@hex-effect/infra-libsql-nats';
import { Config, Layer } from 'effect';

const ConfigLive = Layer.succeed(NatsConfig, {
  config: { servers: Config.string('NATS_SERVER') },
  appNamespace: Config.succeed('Kralf')
}).pipe(
  Layer.merge(Layer.succeed(LibsqlConfig, { config: { url: Config.string('DATABASE_URL') } }))
);

export const Live = InfraLive.pipe(Layer.provide(ConfigLive));
