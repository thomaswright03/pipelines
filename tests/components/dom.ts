// Shared set-up for component tests (files marked `@vitest-environment
// jsdom`): the parts of the browser jsdom lacks, and a promise the test
// resolves by hand so a control's pending state can be observed.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has <dialog> but not its modal methods.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

afterEach(() => cleanup());

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
