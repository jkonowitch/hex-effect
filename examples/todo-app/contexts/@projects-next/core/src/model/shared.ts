import { Schema } from '@effect/schema';

export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));
