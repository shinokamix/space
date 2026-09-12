import { Schema } from "effect";

export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
  environmentId: Schema.String,
});

export const CreateSessionCommand = Schema.Struct({
  commandId: Schema.String,
  cwd: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),
});

export const CreateSessionResponse = Schema.Struct({
  sessionId: Schema.String,
  created: Schema.Boolean,
});

export const TerminalExit = Schema.Union(
  Schema.Struct({
    reason: Schema.Literal("process-exit"),
    code: Schema.Number,
  }),
  Schema.Struct({
    reason: Schema.Literal("runtime-restart", "spawn-error", "user-stop"),
  }),
);

export const RuntimeEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("runtime.ready"),
    timestamp: Schema.String,
    environmentId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.snapshot"),
    sessionId: Schema.String,
    status: Schema.Literal("running"),
    data: Schema.String,
    cols: Schema.Number,
    rows: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.snapshot"),
    sessionId: Schema.String,
    status: Schema.Literal("exited"),
    data: Schema.String,
    cols: Schema.Number,
    rows: Schema.Number,
    exit: TerminalExit,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.data"),
    sessionId: Schema.String,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.exit"),
    sessionId: Schema.String,
    exit: TerminalExit,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.error"),
    message: Schema.String,
    sessionId: Schema.optional(Schema.String),
  }),
);

export const ClientEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("terminal.attach"),
    sessionId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.detach"),
    sessionId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.input"),
    sessionId: Schema.String,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.resize"),
    sessionId: Schema.String,
    cols: Schema.Int.pipe(Schema.positive()),
    rows: Schema.Int.pipe(Schema.positive()),
  }),
  Schema.Struct({
    type: Schema.Literal("terminal.close"),
    sessionId: Schema.String,
  }),
);

export type HealthResponse = typeof HealthResponse.Type;
export type CreateSessionCommand = typeof CreateSessionCommand.Type;
export type CreateSessionResponse = typeof CreateSessionResponse.Type;
export type TerminalExit = typeof TerminalExit.Type;
export type RuntimeEvent = typeof RuntimeEvent.Type;
export type ClientEvent = typeof ClientEvent.Type;
