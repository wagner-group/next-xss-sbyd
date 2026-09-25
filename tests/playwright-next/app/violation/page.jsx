/** Deliberately omit the nonce so automatic observation must fail the test. */
export default function Violation() {
  return <><h1>Violation page</h1><script dangerouslySetInnerHTML={{__html: 'document.documentElement.dataset.unexpected = "yes"'}} /></>;
}
