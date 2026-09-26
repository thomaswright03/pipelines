// Round-10 finding 9: a browser leaving mid-response (e.g. after stopping a
// bulk send) is not logged as a server error; every real error still is.
import { describe, expect, it, vi } from "vitest";
import { CLIENT_DISCONNECT_MESSAGE, isClientDisconnectLog, muteClientDisconnectLogs } from "@/lib/client-disconnect-log";

describe("the client-disconnect log filter", () => {
  it("drops only React's 'destination stream closed early' error, however Next prefixes it", () => {
    const error = vi.fn();
    const target = { error } as unknown as Pick<Console, "error">;
    muteClientDisconnectLogs(target);
    muteClientDisconnectLogs(target); // installing twice doesn't wrap twice

    target.error(" ⨯", Object.assign(new Error(CLIENT_DISCONNECT_MESSAGE), { digest: "1644062040" }));
    expect(error).not.toHaveBeenCalled();

    const real = new Error('relation "Lead" does not exist');
    target.error(" ⨯", real);
    target.error("The destination stream closed early."); // a bare string isn't React's cancel
    target.error(new Error(`${CLIENT_DISCONNECT_MESSAGE} Also something else`));
    expect(error).toHaveBeenCalledTimes(3);
    expect(error.mock.calls[0]).toEqual([" ⨯", real]);
  });

  it("recognises the line by its error, not by text around it", () => {
    expect(isClientDisconnectLog([new Error(CLIENT_DISCONNECT_MESSAGE)])).toBe(true);
    expect(isClientDisconnectLog(["⨯", new Error("The destination stream errored while writing data.")])).toBe(false);
    expect(isClientDisconnectLog([])).toBe(false);
  });
});
