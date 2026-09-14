// Shared by independently bundled package copies in the same runtime. Only safe
// constructors register streams after authenticating their inputs.
const REGISTRY = Symbol.for("next-xss-sbyd.response.safe-streams.v1");
interface Registry {
  streams: WeakSet<ReadableStream>;
  body: (this: Response) => ReadableStream | null;
}

function bodyGetter(): (this: Response) => ReadableStream | null {
  let prototype = Response.prototype;
  while (prototype !== null) {
    const getter = Object.getOwnPropertyDescriptor(prototype, "body")?.get;
    if (getter !== undefined) return getter;
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new Error("Response body accessor is unavailable");
}

function registry(): Registry {
  const existing = Reflect.get(globalThis, REGISTRY) as Registry | undefined;
  if (existing !== undefined) return existing;
  const state: Registry = {streams: new WeakSet(), body: bodyGetter()};
  Object.defineProperty(globalThis, REGISTRY, {value: state});
  // clone() tees the body, replacing the original stream as well as creating a
  // new one. Track both branches, including clones of same-stream rewraps.
  // Find the native owner even when installation already replaced Response.
  let prototype = Response.prototype;
  while (!Object.hasOwn(prototype, "clone")) prototype = Object.getPrototypeOf(prototype);
  const originalClone = prototype.clone;
  Object.defineProperty(prototype, "clone", {
    configurable: true, writable: true,
    value: function clone(this: Response): Response {
      const body = Reflect.apply(state.body, this, []) as ReadableStream | null;
      const trusted = body !== null && state.streams.has(body);
      const result = Reflect.apply(originalClone, this, []) as Response;
      if (trusted) {
        registerSafeResponse(this);
        registerSafeResponse(result);
      }
      return result;
    },
  });
  return state;
}

/** Registers a response only after its body has been authenticated by a safe sink. */
export function registerSafeResponse(response: Response): void {
  const state = registry();
  const body = Reflect.apply(state.body, response, []) as ReadableStream | null;
  if (body !== null) state.streams.add(body);
}

/** Recognizes authenticated bytes, independent of the response object's prototype. */
export function hasSafeResponseBody(body: ReadableStream): boolean {
  const state = Reflect.get(globalThis, REGISTRY) as Registry | undefined;
  return state?.streams.has(body) ?? false;
}

/** Reads the native body, rejecting prototype impostors and ignoring shadowing. */
export function responseBody(response: Response): ReadableStream | null {
  const state = Reflect.get(globalThis, REGISTRY) as Registry | undefined;
  return Reflect.apply(state?.body ?? bodyGetter(), response, []) as ReadableStream | null;
}
