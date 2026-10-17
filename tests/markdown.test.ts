import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/shared/markdown";

describe("renderMarkdown", () => {
  it("renders headings, lists and checkboxes", () => {
    const html = renderMarkdown("## Summary\nWe agreed.\n\n## Action items\n- [ ] Me: send deck\n- [x] Them: book room");
    expect(html).toContain("<h3>Summary</h3>");
    expect(html).toContain("<p>We agreed.</p>");
    expect(html).toContain('<li><span class="check">☐</span> Me: send deck</li>');
    expect(html).toContain('<li><span class="check">☑</span> Them: book room</li>');
  });

  it("renders inline bold, italics and code", () => {
    expect(renderMarkdown("**Budget** is *tight*, see `Q3`")).toBe(
      "<p><strong>Budget</strong> is <em>tight</em>, see <code>Q3</code></p>",
    );
  });

  it("escapes HTML so model output can't inject markup", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>bad()</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});
