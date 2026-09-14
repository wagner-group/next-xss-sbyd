import {ClientGuard} from "./client";

export default function JsxGuardPage() {
  const accepted = [];
  const attack: any = {srcdoc: "unsafe"};
  let blocked = 0;
  try {
    accepted.push(<div {...attack} />);
  } catch (error) {
    if (error instanceof TypeError) blocked += 1;
  }
  return <main data-rsc-guard={accepted.length === 0 ? blocked : -1}><ClientGuard /></main>;
}
