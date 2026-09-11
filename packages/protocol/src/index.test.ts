import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { ClientEvent } from "./index";

describe("ClientEvent", () => {
  it("rejects malformed terminal input", () => {
    expect(() =>
      Schema.decodeUnknownSync(ClientEvent)({
        type: "terminal.input",
        sessionId: 42,
        data: "pwd\n",
      }),
    ).toThrow();
  });
});
