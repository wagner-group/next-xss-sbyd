/** Observe the JSX factory chosen by Next's compiler without mounting raw HTML. */
export function compiledProbe() {
  try {
    const element = <div dangerouslySetInnerHTML={{__html: "raw"}} />;
    // Use the result so production optimization cannot discard a pure JSX call.
    return element.props.dangerouslySetInnerHTML.__html === "raw" ? "accepted" : "unexpected JSX result";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
