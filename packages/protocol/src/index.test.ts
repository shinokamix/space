import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ClientEvent,
  CreateSessionCommand,
  CreateSessionResponse,
  HealthResponse,
  RuntimeEvent,
} from "./index";

describe("ClientEvent", () => {
  it("rejects malformed terminal input", () => {
    expect(() =>
      Schema.decodeUnknownSync(ClientEvent)({
        type: "terminal.input",
        sessionId: 42,
        data: "pwd\n",
      }),
    ).toThrow("Expected string, actual 42");
  });

  it("accepts a terminal close event", () => {
    expect(
      Schema.decodeUnknownSync(ClientEvent)({ type: "terminal.close", sessionId: "session-1" }),
    ).toEqual({ type: "terminal.close", sessionId: "session-1" });
  });

  it("accepts terminal attach and detach events", () => {
    expect(
      Schema.decodeUnknownSync(ClientEvent)({ type: "terminal.attach", sessionId: "session-1" }),
    ).toEqual({ type: "terminal.attach", sessionId: "session-1" });
    expect(
      Schema.decodeUnknownSync(ClientEvent)({ type: "terminal.detach", sessionId: "session-1" }),
    ).toEqual({ type: "terminal.detach", sessionId: "session-1" });
  });
});

describe("terminal session protocol", () => {
  it("includes the environment ID in bootstrap messages", () => {
    expect(
      Schema.decodeUnknownSync(HealthResponse)({
        status: "ok",
        version: "0.1.0",
        environmentId: "environment-1",
      }),
    ).toMatchObject({ environmentId: "environment-1" });
    expect(
      Schema.decodeUnknownSync(RuntimeEvent)({
        type: "runtime.ready",
        timestamp: "2026-09-12T00:00:00.000Z",
        environmentId: "environment-1",
      }),
    ).toMatchObject({ environmentId: "environment-1" });
  });

  it("requires a stable command ID when creating a session", () => {
    expect(
      Schema.decodeUnknownSync(CreateSessionCommand)({ commandId: "terminal.create:panel-1" }),
    ).toEqual({ commandId: "terminal.create:panel-1" });
    expect(() => Schema.decodeUnknownSync(CreateSessionCommand)({ clientId: "client-1" })).toThrow(
      "commandId",
    );
  });

  it("decodes a create response and a running snapshot", () => {
    expect(
      Schema.decodeUnknownSync(CreateSessionResponse)({
        sessionId: "session-1",
        created: true,
      }),
    ).toEqual({ sessionId: "session-1", created: true });
    expect(
      Schema.decodeUnknownSync(RuntimeEvent)({
        type: "terminal.snapshot",
        sessionId: "session-1",
        status: "running",
        data: "ready",
        cols: 100,
        rows: 30,
      }),
    ).toEqual({
      type: "terminal.snapshot",
      sessionId: "session-1",
      status: "running",
      data: "ready",
      cols: 100,
      rows: 30,
    });
  });

  it("distinguishes an interrupted session from a process exit", () => {
    expect(
      Schema.decodeUnknownSync(RuntimeEvent)({
        type: "terminal.snapshot",
        sessionId: "session-1",
        status: "exited",
        data: "",
        cols: 100,
        rows: 30,
        exit: { reason: "runtime-restart" },
      }),
    ).toMatchObject({ exit: { reason: "runtime-restart" } });
  });

  it("requires positive integer terminal dimensions", () => {
    expect(() =>
      Schema.decodeUnknownSync(ClientEvent)({
        type: "terminal.resize",
        sessionId: "session-1",
        cols: 0,
        rows: 30,
      }),
    ).toThrow(/positive/);
    expect(() =>
      Schema.decodeUnknownSync(ClientEvent)({
        type: "terminal.resize",
        sessionId: "session-1",
        cols: 100.5,
        rows: 30,
      }),
    ).toThrow(/integer/);
  });
});
