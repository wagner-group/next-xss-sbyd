/** Common hostile input shared by server rendering, hydration and browser updates. */
export const markdownSource = `# Markdown preview

A **strong** word and *emphasis*, with \`literal code\`.

> A quotation

3. third
4. fourth

[Safe navigation](/markdown?visited=yes)

![Safe picture](/favicon.ico)

[Mixed script](JaVaScRiPt:alert%281%29)
[Encoded script](jav&#x61;script:alert%281%29)
[Protocol relative](//attacker.invalid/markdown-probe)
[Data link](data:text/html,attack)
[Blob link](blob:https://attacker.invalid/id)
[Fragment](#location)
[Relative](./page)

![Rejected picture](data:image/svg+xml,attack)
![Rejected remote](//attacker.invalid/markdown-probe)

<script>globalThis.markdownAttacked = true</script>
<img src="https://attacker.invalid/markdown-probe" onerror="globalThis.markdownAttacked=true">
<svg onload="globalThis.markdownAttacked=true"><a id="location">svg</a></svg>
<math><mtext><img src="https://attacker.invalid/markdown-probe"></mtext></math>
<form id="location" name="document"><input name="cookie"></form>

Malformed <b><i>nesting</b></i> remains text.

{globalThis.markdownAttacked = true}

---

\`\`\`html
<img src=x onerror=alert(1)>
\`\`\`
`;
