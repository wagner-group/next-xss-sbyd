Our mission is to help developers avoid XSS vulnerabilities
in their Next.JS web applications, and especially, to make it
easy to retrofit legacy applications to use these APIs so they
will be free of XSS vulnerabilities (or to write new code that
uses these APIs to avoid XSS vulnerabilities). Everything should
be connected to that mission.

All writing should use clear communication. Use plain language.
Write for an audience that is a security expert but not necessarily
an expert in Next.js, React, Node.js, tsec, or Typescript. Provide
background as necessary to make it easy to understand.

Avoid AI slop. Avoid jargon that tends to be overused by
LLMs, e.g., load-bearing, gate, seam, boundary, topology,
shape. Avoid the "X not Y" pattern. Avoid vague exciting-sounding
generalities; be concrete. Avoid vapid marketing speak.

Avoid super-terse/compressed language that will be hard for a human
to understand. Avoid inventing custom noun phrases. All noun
phrases should either have a standard meaning that will be
understood by our audience, or be introduced/defined in docs/design.md,
or must be introduced and defined/explained before first use.

When filing a Github issue or leaving a comment on an issue
or PR, identify it as written by KISS.

When you file a Github issue, explain it in a self-contained way.
State the problem or opportunity for improvement (driven by the
mission). Explain the motivation (why should I care? what is bad
about the current state of affairs, or how will it be better if this
proposal is adopted? explain its impact on our mission. provide
one or two simple edifying examples with code). Provide any
necessary background.

After you file a Github issue, spawn a separate subagent to
evaluate possible solutions. If you identify a proposed solution,
or several options, leave a comment with a detailed proposal:
for each, explain the main idea, the detailed design (this should
list all new/changed APIs, their type signature, their
semantics/behavior, and give an example or two of usage that
helps motivate why they'll be useful), and if you list multiple,
provide an evaluation of the tradeoffs and a recommendation if
you have one.

All PRs should contain tests. Also add tests for
maintainability, i.e., to increase the likelihood that if
critical dependencies change in a way that breaks next-xss-sbyd,
this will be surfaced in a CI test and have a message that
explains the problem/broken assumption.
