import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Schema } from "effect";

export type TerminalExitReason = "process-exit" | "runtime-restart" | "spawn-error" | "user-stop";

export class EnvironmentInUseError extends Error {
  constructor(filename: string) {
    super(`Another Space runtime already owns the environment database: ${filename}`);
  }
}

export class CommandConflictError extends Error {
  constructor(commandId: string) {
    super(`Command ID ${commandId} was already used with a different payload`);
  }
}

export interface TerminalSessionRecord {
  readonly id: string;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly status: "running" | "exited";
  readonly startedAt: string;
  readonly exitedAt: string | undefined;
  readonly exitReason: TerminalExitReason | undefined;
  readonly exitCode: number | undefined;
}

interface CreateTerminalInput {
  readonly commandId: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly startedAt: string;
  readonly commandPayload: string;
}

const CommandReceiptRow = Schema.Struct({
  command_type: Schema.String,
  session_id: Schema.String,
  command_payload: Schema.NullOr(Schema.String),
});

const RuntimeMetadataRow = Schema.Struct({ value: Schema.String });

const TableInfoRow = Schema.Struct({ name: Schema.String });

const TerminalSessionRow = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  shell: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
  status: Schema.Literal("running", "exited"),
  started_at: Schema.String,
  exited_at: Schema.NullOr(Schema.String),
  exit_reason: Schema.NullOr(
    Schema.Literal("process-exit", "runtime-restart", "spawn-error", "user-stop"),
  ),
  exit_code: Schema.NullOr(Schema.Number),
});

type TerminalSessionRow = typeof TerminalSessionRow.Type;

const decodeCommandReceiptRow = Schema.decodeUnknownSync(Schema.UndefinedOr(CommandReceiptRow));
const decodeRuntimeMetadataRow = Schema.decodeUnknownSync(Schema.UndefinedOr(RuntimeMetadataRow));
const decodeTableInfoRows = Schema.decodeUnknownSync(Schema.Array(TableInfoRow));
const decodeTerminalSessionRow = Schema.decodeUnknownSync(TerminalSessionRow);

interface LockOwner {
  readonly token: string;
  readonly pid: number;
  readonly processMarker?: string | undefined;
}

const LockOwner = Schema.Struct({
  token: Schema.String,
  pid: Schema.Number,
  processMarker: Schema.optional(Schema.String),
});

const decodeLockOwner = Schema.decodeUnknownSync(LockOwner);

const hasErrorCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

const getProcessMarker = (pid: number) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
};

const isOwnerAlive = (owner: LockOwner) => {
  try {
    process.kill(owner.pid, 0);
  } catch {
    return false;
  }
  const marker = getProcessMarker(owner.pid);
  return (
    owner.processMarker === undefined || marker === undefined || marker === owner.processMarker
  );
};

class EnvironmentLock {
  private released = false;

  private constructor(
    private readonly directory: string,
    private readonly owner: LockOwner,
  ) {}

  static acquire(filename: string) {
    const directory = `${resolve(filename)}.runtime-lock`;
    const owner: LockOwner = {
      token: randomUUID(),
      pid: process.pid,
      processMarker: getProcessMarker(process.pid),
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        mkdirSync(directory);
        writeFileSync(`${directory}/owner.json`, JSON.stringify(owner), { flag: "wx" });
        return new EnvironmentLock(directory, owner);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
        let existing: LockOwner | undefined;
        try {
          existing = decodeLockOwner(JSON.parse(readFileSync(`${directory}/owner.json`, "utf8")));
        } catch {
          existing = undefined;
        }
        if (existing && isOwnerAlive(existing)) throw new EnvironmentInUseError(filename);
        try {
          unlinkSync(`${directory}/owner.json`);
        } catch (removeError) {
          if (!hasErrorCode(removeError, "ENOENT")) throw removeError;
        }
        try {
          rmdirSync(directory);
        } catch (removeError) {
          if (!hasErrorCode(removeError, "ENOENT")) continue;
        }
      }
    }
    throw new EnvironmentInUseError(filename);
  }

  release() {
    if (this.released) return;
    this.released = true;
    try {
      const current = decodeLockOwner(
        JSON.parse(readFileSync(`${this.directory}/owner.json`, "utf8")),
      );
      if (current.token !== this.owner.token) return;
      unlinkSync(`${this.directory}/owner.json`);
      rmdirSync(this.directory);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
  }
}

const toTerminalSession = (row: TerminalSessionRow): TerminalSessionRecord => ({
  id: row.id,
  cwd: row.cwd,
  shell: row.shell,
  cols: row.cols,
  rows: row.rows,
  status: row.status,
  startedAt: row.started_at,
  exitedAt: row.exited_at ?? undefined,
  exitReason: row.exit_reason ?? undefined,
  exitCode: row.exit_code ?? undefined,
});

const addColumn = (database: DatabaseSync, name: string, definition: string) => {
  const columns = decodeTableInfoRows(
    database.prepare("PRAGMA table_info(terminal_sessions)").all(),
  );
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE terminal_sessions ADD COLUMN ${name} ${definition}`);
  }
};

const addReceiptColumn = (database: DatabaseSync, name: string, definition: string) => {
  const columns = decodeTableInfoRows(
    database.prepare("PRAGMA table_info(command_receipts)").all(),
  );
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE command_receipts ADD COLUMN ${name} ${definition}`);
  }
};

const migrate = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runtime_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      shell TEXT NOT NULL DEFAULT '',
      cols INTEGER NOT NULL DEFAULT 100,
      rows INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      exited_at TEXT,
      exit_reason TEXT,
      exit_code INTEGER
    );
  `);

  addColumn(database, "shell", "TEXT NOT NULL DEFAULT ''");
  addColumn(database, "cols", "INTEGER NOT NULL DEFAULT 100");
  addColumn(database, "rows", "INTEGER NOT NULL DEFAULT 30");
  addColumn(database, "status", "TEXT NOT NULL DEFAULT 'running'");
  addColumn(database, "exit_reason", "TEXT");

  database.exec(`
    UPDATE terminal_sessions
    SET status = CASE WHEN exited_at IS NULL THEN 'running' ELSE 'exited' END;

    CREATE TABLE IF NOT EXISTS command_receipts (
      command_id TEXT PRIMARY KEY,
      command_type TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES terminal_sessions(id),
      command_payload TEXT,
      created_at TEXT NOT NULL
    );
  `);
  addReceiptColumn(database, "command_payload", "TEXT");
};

export class RuntimeDatabase {
  readonly environmentId: string;

  constructor(
    private readonly database: DatabaseSync,
    private readonly environmentLock: EnvironmentLock,
  ) {
    migrate(database);
    const existing = decodeRuntimeMetadataRow(
      database.prepare("SELECT value FROM runtime_metadata WHERE key = 'environment_id'").get(),
    );
    this.environmentId = existing?.value ?? randomUUID();
    if (!existing) {
      database
        .prepare("INSERT INTO runtime_metadata (key, value) VALUES ('environment_id', ?)")
        .run(this.environmentId);
    }
  }

  close() {
    try {
      this.database.close();
    } finally {
      this.environmentLock.release();
    }
  }

  interruptRunningTerminals(at: string) {
    this.database
      .prepare(
        `UPDATE terminal_sessions
         SET status = 'exited', exited_at = ?, exit_reason = 'runtime-restart', exit_code = NULL
         WHERE status = 'running'`,
      )
      .run(at);
  }

  createTerminal(input: CreateTerminalInput): {
    readonly created: boolean;
    readonly session: TerminalSessionRecord;
  } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const receipt = decodeCommandReceiptRow(
        this.database
          .prepare(
            `SELECT command_type, session_id, command_payload
             FROM command_receipts WHERE command_id = ?`,
          )
          .get(input.commandId),
      );
      if (receipt) {
        if (receipt.command_type !== "terminal.create") {
          throw new Error(`Command ID ${input.commandId} belongs to ${receipt.command_type}`);
        }
        const session = this.getTerminalSession(receipt.session_id);
        if (!session) throw new Error(`Receipt refers to missing session ${receipt.session_id}`);
        const storedPayload =
          receipt.command_payload ??
          JSON.stringify({ cwd: resolve(session.cwd), shell: session.shell });
        if (storedPayload !== input.commandPayload) throw new CommandConflictError(input.commandId);
        this.database.exec("COMMIT");
        return { created: false, session };
      }

      this.database
        .prepare(
          `INSERT INTO terminal_sessions
             (id, cwd, shell, cols, rows, status, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?)`,
        )
        .run(input.sessionId, input.cwd, input.shell, input.cols, input.rows, input.startedAt);
      this.database
        .prepare(
          `INSERT INTO command_receipts
             (command_id, command_type, session_id, command_payload, created_at)
           VALUES (?, 'terminal.create', ?, ?, ?)`,
        )
        .run(input.commandId, input.sessionId, input.commandPayload, input.startedAt);
      this.database.exec("COMMIT");
      return {
        created: true,
        session: {
          id: input.sessionId,
          cwd: input.cwd,
          shell: input.shell,
          cols: input.cols,
          rows: input.rows,
          status: "running",
          startedAt: input.startedAt,
          exitedAt: undefined,
          exitReason: undefined,
          exitCode: undefined,
        },
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.database
      .prepare("UPDATE terminal_sessions SET cols = ?, rows = ? WHERE id = ?")
      .run(cols, rows, sessionId);
  }

  exitTerminal(
    sessionId: string,
    exit: { readonly at: string; readonly reason: TerminalExitReason; readonly code?: number },
  ) {
    this.database
      .prepare(
        `UPDATE terminal_sessions
         SET status = 'exited', exited_at = ?, exit_reason = ?, exit_code = ?
         WHERE id = ?`,
      )
      .run(exit.at, exit.reason, exit.code ?? null, sessionId);
  }

  getTerminalSession(sessionId: string) {
    const row = this.database
      .prepare(
        `SELECT id, cwd, shell, cols, rows, status, started_at, exited_at, exit_reason, exit_code
         FROM terminal_sessions WHERE id = ?`,
      )
      .get(sessionId);
    return row === undefined ? undefined : toTerminalSession(decodeTerminalSessionRow(row));
  }
}

export const openRuntimeDatabase = (filename = process.env.SPACE_DATABASE_PATH ?? "space.db") =>
  (() => {
    const environmentLock = EnvironmentLock.acquire(filename);
    try {
      return new RuntimeDatabase(new DatabaseSync(filename), environmentLock);
    } catch (error) {
      environmentLock.release();
      throw error;
    }
  })();
