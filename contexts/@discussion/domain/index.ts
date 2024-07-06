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
}) {
  public static create(projectId: typeof ProjectId.Type) {
    return Effect.gen(function* () {
      const discussion = Discussion.make({ id: yield* Effect.serviceFunctions(DiscussionRepository).nextId(), projectId });
      yield* Effect.serviceFunctions(DiscussionDomainPublisher).publish(DiscussionCreatedEvent.make({ discussionId: discussion.id }))
      return discussion;
    })
  }

  public addComment(content: string) {
    return Comment.create(this.id, content);
  }
}

const CommentId = Schema.String.pipe(Schema.brand('CommentId'))

export class Comment extends Schema.TaggedClass<Comment>()("Comment", {
  id: CommentId,
  discussionId: DiscussionId,
  content: Schema.String
}) {
  public static create(discussionId: typeof DiscussionId.Type, content: string) {
    return Effect.gen(function* () {
      const comment = Comment.make({ id: yield* Effect.serviceFunctions(CommentRepository).nextId(), discussionId, content })
      yield* Effect.serviceFunctions(DiscussionDomainPublisher).publish(CommentCreatedEvent.make({ commentId: comment.id }))
      return comment
    })
  }
}

export const DiscussionCreatedEvent = Schema.TaggedStruct("DiscussionCreatedEvent", {
  discussionId: DiscussionId
})

export const CommentCreatedEvent = Schema.TaggedStruct("CommentCreatedEvent", {
  commentId: CommentId
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

const allEvents = Schema.Union(CommentCreatedEvent, DiscussionCreatedEvent)

export class DiscussionDomainPublisher extends Context.Tag("DiscussionDomainPublisher")<DiscussionDomainPublisher, {
  publish(event: typeof allEvents.Type): Effect.Effect<void>
}>() { }