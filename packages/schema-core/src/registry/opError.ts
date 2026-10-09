/** All registry operations throw this on invalid input. */
export class OpError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "OpError";
  }
}
