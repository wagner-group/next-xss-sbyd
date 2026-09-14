import type {NextApiRequest, NextApiResponse} from "next";

export default function handler(_request: NextApiRequest, response: NextApiResponse) {
  response.send("<h1>unsafe</h1>");
  response?.["write"]("unsafe");
  response.end(`unsafe`);
  const responseAlias = response;
  responseAlias.send("unsafe alias");
  const {send} = response;
  send("unsafe destructured method");
  const queue: {send(value: string): void} = {send: () => undefined};
  queue.send("unrelated");
}
