"use client";

import {useEffect, useState, type ChangeEvent} from "react";
import Link from "next/link";
import SafeImage from "next-xss-sbyd/compat/image";
import Masonry from "react-masonry-css";
import {Command} from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";
import {useTheme} from "next-themes";
import {getNonce as getStyleNonce} from "get-nonce";
import {useDropzone} from "react-dropzone";
import {Toaster, toast} from "sonner";

const columns = [1, 2, 3, 4, 5, 6] as const;
const items = [1, 2, 3, 4, 5, 6];

/** Retains Next's generated inline styles and optimized image URLs. */
function RecipeImage({fill = false}: {fill?: boolean}) {
  return <SafeImage src="/csp-image.png" alt={fill ? "Fill recipe" : "Intrinsic recipe"}
    {...(fill ? {fill: true, sizes: "240px", style: {objectFit: "cover", objectPosition: "25% 50%"}} : {width: 240, height: 160})}
    data-testid={fill ? "fill-image" : "intrinsic-image"} />;
}

/** Exercises library inline styles and nonce-bearing stylesheets. */
export function StyleRecipes({next}: {next: boolean}) {
  const [hydrated, setHydrated] = useState(false);
  const [fruit, setFruit] = useState("apple");
  const [indent, setIndent] = useState(24);
  const {theme, setTheme} = useTheme();
  const {getRootProps, getInputProps, acceptedFiles} = useDropzone();
  useEffect(function markHydrated() { setHydrated(true); }, []);
  function changeIndentation(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.valueAsNumber;
    if (Number.isFinite(value) && value >= 0 && value <= 160) setIndent(value);
  }

  return <main className="recipes">
    <h1>{next ? "Style recipes after navigation" : "CSP style recipes"}</h1>
    <output data-testid="hydrated">{hydrated ? "ready" : "pending"}</output>
    <Link href={next ? "/csp-styles" : "/csp-styles/next"}>{next ? "Back to style page" : "Next style page"}</Link>
    <section aria-label="Images">
      <RecipeImage />
      <div className="fill-frame" data-testid="fill-frame"><RecipeImage fill /></div>
    </section>
    <section aria-label="Dialog">
      <Dialog.Root>
        <Dialog.Trigger>Open dialog</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Nonce dialog</Dialog.Title>
            <Dialog.Description>Opening this dialog locks background scrolling.</Dialog.Description>
            <Dialog.Close>Close dialog</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
    <section aria-label="Radix interactions">
      <Select.Root value={fruit} onValueChange={setFruit}>
        <Select.Trigger aria-label="Fruit"><Select.Value /></Select.Trigger>
        <Select.Portal><Select.Content position="popper" className="select-content" sideOffset={4}>
          <Select.Viewport nonce={getStyleNonce()}>
            <Select.Item value="apple"><Select.ItemText>Apple</Select.ItemText></Select.Item>
            <Select.Item value="banana"><Select.ItemText>Banana</Select.ItemText></Select.Item>
          </Select.Viewport>
        </Select.Content></Select.Portal>
      </Select.Root>
      <output data-testid="selected-fruit">{fruit}</output>
      <Tabs.Root defaultValue="overview">
        <Tabs.List aria-label="Information"><Tabs.Trigger value="overview">Overview</Tabs.Trigger><Tabs.Trigger value="details">Details</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="overview">Overview content</Tabs.Content>
        <Tabs.Content value="details">Details content</Tabs.Content>
      </Tabs.Root>
      <Switch.Root aria-label="Notifications" className="switch"><Switch.Thumb className="switch-thumb" /></Switch.Root>
    </section>
    <section aria-label="Theme and toast">
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Toggle theme</button>
      <output data-testid="theme">{hydrated ? theme : "pending"}</output>
      <button onClick={() => toast("CSP stylesheet toast", {id: "fixture-toast", duration: Infinity})}>Show toast</button>
      <button onClick={() => toast.dismiss("fixture-toast")}>Dismiss toast</button>
      <Toaster closeButton />
    </section>
    <section aria-label="Library styles">
      <div {...getRootProps({className: "dropzone", "aria-label": "Upload files"})}>
        <input {...getInputProps()} data-testid="dropzone-input" />
        Choose or drop files
      </div>
      <output data-testid="uploaded-files">{acceptedFiles.map(file => file.name).join(", ")}</output>
      {columns.map(count => <Masonry key={count} breakpointCols={count} className="masonry" columnClassName="masonry-column" data-testid={`masonry-${count}`}>
        {items.map(item => <div className="masonry-item" key={item}>Item {item}</div>)}
      </Masonry>)}
      <Command label="Search commands"><Command.Input /><Command.List>
        <Command.Item>Open</Command.Item><Command.Item>Save</Command.Item>
      </Command.List></Command>
    </section>
    <section aria-label="Dynamic styles">
      <p data-testid="bounded-style" data-density="compact" className="bounded-style">Bounded compact spacing</p>
      <label>Indentation<input type="number" min={0} max={160} value={indent} onChange={changeIndentation} /></label>
      <p style={{paddingLeft: indent}} data-testid="dynamic-indent">Dynamic React style</p>
      <label>Native size<input data-testid="native-size" size={12} /></label>
      <svg width="32" height="32" aria-label="Presentation attribute icon" role="img"><circle data-testid="svg-shape" cx="16" cy="16" r="12" fill="#13678a" stroke="#000" strokeWidth="2" /></svg>
    </section>
    <div className="scroll-space">Scroll-lock test space</div>
  </main>;
}
