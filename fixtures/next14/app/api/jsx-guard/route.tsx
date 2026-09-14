import {htmlEscape} from "next-xss-sbyd";

export const runtime = "edge";

export function GET() {
  const benign = <div {...{id: "unchanged"}} key="fallback">content</div>;
  const safeProps: any = {srcDoc: htmlEscape("<b>safe</b>")};
  const safe = <iframe {...safeProps} />;
  const attacks = [
    {dangerouslySetInnerHTML: {__html: "<script>alert(1)</script>"}},
    {SRCDOC: "<script>alert(1)</script>"},
  ];
  let blocked = 0;
  const accepted = [];
  for (const attackerProps of attacks) {
    try {
      accepted.push(<div {...attackerProps} />);
    } catch (error) {
      if (error instanceof TypeError) blocked += 1;
    }
  }
  return Response.json({
    runtime: "edge",
    benign: benign.props.id === "unchanged" && benign.props.children === "content" && accepted.length === 0,
    safe: safe.props.srcDoc === "&lt;b&gt;safe&lt;/b&gt;",
    blocked,
  });
}
