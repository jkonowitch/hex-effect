import { Context, Layer, PubSub } from 'effect';

export class UseCaseCommit extends Context.Tag('@hex-effect/UseCaseCommit')<
  UseCaseCommit,
  PubSub.PubSub<void>
>() {
  public static live = Layer.effect(UseCaseCommit, PubSub.sliding<void>(10));
}
