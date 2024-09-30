import { LibsqlClient } from '@effect/sql-libsql';
import { describe, expect, it } from '@effect/vitest';
import { Console, Effect } from 'effect';

const makeClient = LibsqlClient.make({ url: 'http://localhost:8080' });

describe('kralf', () => {
  it.scoped('does a thing', () =>
    Effect.gen(function* () {
      const num = yield* Effect.succeed(4);
      expect(num).toEqual(4);
      const sql = yield* makeClient;
      const res = yield* sql`select * from sqlite_master;`;
      yield* Console.log(res);
    })
  );
});
