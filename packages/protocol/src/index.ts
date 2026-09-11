import { Schema } from "effect";

export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
});

export const CreateSessionCommand = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),
});

export const RuntimeEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("runtime.ready"),
    timestamp: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.opened"),
    sessionId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.data"),
    sessionId: Schema.String,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.exit"),
    sessionId: Schema.String,
    exitCode: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.error"),
    message: Schema.String,
  }),
);

export const ClientEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("terminal.input"),
    sessionId: Schema.String,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.resize"),
    sessionId: Schema.String,
    cols: Schema.Number,
    rows: Schema.Number,
  }),
);

export type HealthResponse = typeof HealthResponse.Type;
export type CreateSessionCommand = typeof CreateSessionCommand.Type;
export type RuntimeEvent = typeof RuntimeEvent.Type;
export type ClientEvent = typeof ClientEvent.Type;
