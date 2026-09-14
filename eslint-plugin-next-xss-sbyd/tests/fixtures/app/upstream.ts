/** Fetches data from the application's fixed upstream. */
export function upstream(): Promise<Response> {
  return fetch("https://example.test");
}
