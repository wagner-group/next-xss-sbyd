import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {createCspReportHandler} from "next-xss-sbyd/csp";

export const POST = withSafeRouteHandler((createCspReportHandler({log: (report) => console.info("fixture-csp-report", report)})));
