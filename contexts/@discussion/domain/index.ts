import { Schema } from "@effect/schema";

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