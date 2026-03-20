import { Effect, Layer, Schema } from 'effect';
import { SqlClient } from '@effect/sql';
import { InfrastructureError } from '@hex-effect/core';
import { WriteStatement } from '@hex-effect/infra-nats';
import { Services } from '@badges/application';
import { Badge } from '@badges/domain';

export const GetCompletedTaskCountLive = Layer.effect(
  Services.GetCompletedTaskCount,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      getCount: () =>
        sql`SELECT COUNT(*) as count FROM tasks WHERE completed = 1;`.pipe(
          Effect.flatMap(
            Schema.decodeUnknown(
              Schema.Array(
                Schema.Struct({ count: Schema.Union(Schema.Number, Schema.NumberFromString) })
              )
            )
          ),
          Effect.map((rows) => rows[0]?.count ?? 0),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

// Handles both SQLite (epoch ms as INTEGER) and PostgreSQL (BIGINT returned as string)
const EpochToDate = Schema.transform(
  Schema.Union(Schema.Number, Schema.NumberFromString),
  Schema.DateFromSelf,
  { decode: (n) => new Date(n), encode: (d) => d.getTime() }
);

const BadgeFromDb = Schema.Struct({
  id: Badge.BadgeId,
  badgeType: Badge.BadgeType,
  awardedAt: Schema.Union(Schema.DateFromSelf, EpochToDate)
});

export const GetAllBadgesLive = Layer.effect(
  Services.GetAllBadges,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      getAll: () =>
        sql`SELECT * FROM badges ORDER BY awarded_at DESC;`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(BadgeFromDb))),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

export const SaveBadgeLive = Layer.effect(
  Services.SaveBadge,
  Effect.zip(SqlClient.SqlClient, WriteStatement).pipe(
    Effect.map(([sql, write]) => ({
      save: (b: typeof Badge.Badge.Type) =>
        write(
          sql`INSERT INTO badges ${sql.insert({ id: b.id, badgeType: b.badgeType, awardedAt: b.awardedAt.getTime() })};`
        ).pipe(Effect.mapError((e) => new InfrastructureError({ cause: e })))
    }))
  )
);
