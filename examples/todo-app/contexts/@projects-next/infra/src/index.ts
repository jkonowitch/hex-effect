import { Live as InfraLive, NatsConfig, LibsqlConfig } from '@hex-effect/infra-libsql-nats';
import { Config, Console, Effect, Layer, ManagedRuntime } from 'effect';

const ConfigLive = Layer.succeed(NatsConfig, {
  config: { servers: Config.string('NATS_SERVER') },
  appNamespace: Config.succeed('Kralf')
}).pipe(
  Layer.merge(Layer.succeed(LibsqlConfig, { config: { url: Config.string('DATABASE_URL') } }))
);

const Live = InfraLive.pipe(Layer.provide(ConfigLive));

const rt = ManagedRuntime.make(Live);

await Effect.runPromise(Console.log('asd').pipe(Effect.provide(rt)));
await rt.dispose();
