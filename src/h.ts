/**
 * A lightweight hyperscript helper to create DOM elements.
 *
 * @example
 *   // Basic usage
 *   h("div", { class: "container" }, ["Hello World"]);
 *
 * @example
 *   // Nested arrays of children
 *   h("div", null, [["Span 1", "Span 2"], h("p", null, [["Nested line 1", "Nested line 2"]])]);
 *
 * @example
 *   // Setting event listeners and returning a new element
 *   h("div", null, [
 *     (el) => {
 *       el.onclick = () => console.log("Div clicked!");
 *       return h("span", null, ["I was created by a function!"]);
 *     },
 *   ]);
 */
export function h(type: string, attrs?: Record<string, unknown>, children?: unknown): HTMLElement {
  const e = document.createElement(type);

  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === "function" && k.toLowerCase().startsWith("on")) {
        e.addEventListener(k.toLowerCase().slice(2), v as EventListener);
      } else if (v === null || v === undefined) {
        e.removeAttribute(k);
      } else if (Array.isArray(v)) {
        e.className = v.join(" ");
      } else if (typeof v === "object") {
        e.setAttribute(
          k,
          Object.entries(v)
            .map((pair) => pair.join(":"))
            .join(";"),
        );
      } else {
        e.setAttribute(k, String(v));
      }
    }
  }

  function appendRecursive(node: HTMLElement, items: unknown) {
    const itemsArray = Array.isArray(items) ? items : [items];
    for (let item of itemsArray) {
      if (typeof item === "function") {
        const result = item(node);
        if (result) appendRecursive(node, result);
      } else if (item) {
        if (Array.isArray(item)) {
          appendRecursive(node, item);
        } else {
          node.append(item);
        }
      }
    }
  }

  appendRecursive(e, children);
  return e;
}
