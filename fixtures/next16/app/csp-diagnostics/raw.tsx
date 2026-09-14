"use client";

import Link from "next/link";
import SafeImage from "next-xss-sbyd/compat/image";
import Masonry from "react-masonry-css";
import {Command} from "cmdk";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";

/** Retains original library styles for first-paint compatibility checks. */
export function RawStyles({next = false}: {next?: boolean}) {
  return <main className="recipes">
    <h1>{next ? "CSP diagnostics after navigation" : "Raw CSP diagnostics"}</h1>
    <Link href={next ? "/csp-diagnostics" : "/csp-diagnostics/next"}>{next ? "Back to diagnostics" : "Next diagnostic page"}</Link>
    <SafeImage src="/csp-image.svg" alt="Raw intrinsic" width={240} height={160} data-testid="raw-intrinsic-image" />
    <div className="fill-frame" data-testid="raw-fill-frame"><SafeImage src="/csp-image.svg" alt="Raw fill" fill data-testid="raw-fill-image" /></div>
    <Masonry breakpointCols={3} className="masonry" columnClassName="masonry-column" data-testid="raw-masonry">
      {[1, 2, 3, 4, 5, 6].map(item => <div key={item}>Item {item}</div>)}
    </Masonry>
    <Command label="Raw command menu"><Command.Input /><Command.List><Command.Item>Open</Command.Item><Command.Item>Save</Command.Item></Command.List></Command>
    <section aria-label="Raw server-rendered Radix">
      <Select.Root defaultValue="apple">
        <Select.Trigger aria-label="Raw fruit"><Select.Value /></Select.Trigger>
        <Select.Portal><Select.Content><Select.Viewport>
          <Select.Item value="apple"><Select.ItemText>Apple</Select.ItemText></Select.Item>
          <Select.Item value="banana"><Select.ItemText>Banana</Select.ItemText></Select.Item>
        </Select.Viewport></Select.Content></Select.Portal>
      </Select.Root>
      <Tabs.Root defaultValue="overview">
        <Tabs.List aria-label="Raw tabs"><Tabs.Trigger value="overview">Raw overview</Tabs.Trigger><Tabs.Trigger value="details">Raw details</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="overview">Raw overview content</Tabs.Content>
        <Tabs.Content value="details">Raw details content</Tabs.Content>
      </Tabs.Root>
      <Switch.Root aria-label="Raw notifications"><Switch.Thumb /></Switch.Root>
    </section>
  </main>;
}
