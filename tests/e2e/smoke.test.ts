import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";

import { app } from "../../src/app.ts";
import { h } from "../../src/h.ts";

function loadFullApp() {
  document.head.append(
    h("title", {}, ["Swing Editor"]),
    h("link", { rel: "stylesheet", href: "src/main.css" }),
  );
  document.body.append(...app());
}

function getActiveTab(): string | undefined {
  return document.getElementsByClassName("tabs-active")?.[0]?.firstChild?.textContent ?? undefined;
}

function getActiveEditor() {
  for (const editor of document.querySelectorAll(".editor-pane")) {
    if (editor instanceof HTMLElement && editor.style.display !== "none") {
      return editor;
    }
  }
  return undefined;
}

function wait(): Promise<void> {
  // TODO: Find a better way to do this than a hard-coded sleep.
  return new Promise((resolve) => setInterval(resolve, 100));
}

describe("smoke", () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadFullApp();
  });

  test("starts", async () => {
    expect(document.getElementById("sidebar")).toBeVisible();
    expect(document.getElementById("main-content")).toBeVisible();
    expect(document.getElementById("chat-panel")).toBeVisible();
  });

  test("opens files", async () => {
    await userEvent.click(page.getByText("main.js").first());
    await wait();

    expect(getActiveTab()).toBe("main.js");
    expect(getActiveEditor()).toHaveTextContent("document.getElementById");

    await userEvent.click(page.getByText("index.html").first());
    await wait();

    expect(getActiveTab()).toBe("index.html");
    expect(getActiveEditor()).toHaveTextContent("<!DOCTYPE html>");
  });

  test("renames foreground file", async () => {
    await userEvent.click(page.getByText("main.js").first());
    await wait();
    await userEvent.click(page.getByText("index.html").first());
    await wait();

    await userEvent.dblClick(page.getByText("index.html").first());
    await userEvent.keyboard("foo.html\n");
    await wait();

    expect(getActiveTab()).toBe("foo.html");
    expect(getActiveEditor()).toHaveTextContent("<!DOCTYPE html>");
  });

  test("renames background file", async () => {
    await userEvent.click(page.getByText("main.js").first());
    await wait();
    await userEvent.click(page.getByText("index.html").first());
    await wait();

    await userEvent.dblClick(page.getByText("main.js").first());
    await userEvent.keyboard("foo.js\n");
    await wait();

    expect(getActiveTab()).toBe("foo.js");
    expect(getActiveEditor()).toHaveTextContent("document.getElementById");
  });
});
