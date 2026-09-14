export {passiveResponse, type PassiveResponse} from "./passive-response.js";
import {validateRouteResponse} from "./internal/route-response.js";

/** Checks a handler's final response, preserving its arguments and async errors. */
export function withSafeRouteHandler<This, Args extends unknown[]>(
  handler: (this: This, ...args: Args) => Response | Promise<Response>,
  subject = "Route handler",
): (this: This, ...args: Args) => Promise<Response> {
  return async function safeRouteHandler(this: This, ...args: Args): Promise<Response> {
    return validateRouteResponse(await Reflect.apply(handler, this, args), subject);
  };
}
