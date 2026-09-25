import {createXssSbydHandler} from "next-xss-sbyd/csp";

export const proxy = createXssSbydHandler();
export const config = {matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]};
