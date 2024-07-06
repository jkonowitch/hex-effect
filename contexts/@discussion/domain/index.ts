import { Schema } from "@effect/schema";
import { Context, Effect } from "effect";

/**
 * Model
 */

const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))

const DiscussionId = Schema.String.pipe(Schema.brand("DiscussionId"));

export class Discussion extends Schema.TaggedClass<Discussion>()("Discussion", {
  id: DiscussionId,
  projectId: ProjectId,
}) { }

const CommentId = Schema.String.pipe(Schema.brand('CommentId'))

export class Comment extends Schema.TaggedClass<Comment>()("Comment", {
  id: CommentId,
  discussionId: DiscussionId,
  content: Schema.String
}) { }

export const DiscussionCreatedEvent = Schema.TaggedStruct("DiscussionCreatedEvent", {
  discussionId: DiscussionId
})

/**
 * Services
 */

export class DiscussionRepository extends Context.Tag("DiscussionRepository")<DiscussionRepository, {
  save(discussion: Discussion): Effect.Effect<void>;
  findById(id: typeof DiscussionId.Type): Effect.Effect<Discussion>;
  nextId(): Effect.Effect<typeof DiscussionId.Type>;
}>() { }

export class CommentRepository extends Context.Tag("CommentRepository")<CommentRepository, {
  save(comment: Comment): Effect.Effect<void>;
  findById(id: typeof CommentId.Type): Effect.Effect<Comment>;
  nextId(): Effect.Effect<typeof CommentId.Type>;
}>() { }
