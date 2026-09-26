// Renders an App Router page (an async server component) to a DOM the
// tests can query, outside Next: async components in the tree are awaited
// here (react-dom's server renderer only renders synchronous ones), then the
// tree is rendered to HTML and placed in the test's jsdom document. Client components render
// their first (server) pass, as they would in the HTML Next sends.
// next/navigation, next/link and next/form are mocked by the test file.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { within } from "@testing-library/dom";

function isAsyncComponent(type: unknown): type is (props: unknown) => Promise<ReactNode> {
  return typeof type === "function" && type.constructor.name === "AsyncFunction";
}

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (isAsyncComponent(element.type)) return resolve(await element.type(element.props));
  const props: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(element.props)) {
    if (isValidElement(value) || (Array.isArray(value) && value.some(isValidElement))) {
      props[key] = await resolve(value as ReactNode);
      changed = true;
    }
  }
  return changed ? cloneElement(element, props) : element;
}

/** The page's HTML (in a detached element), with Testing Library queries bound to it. */
export async function renderPage(page: ReactNode | Promise<ReactNode>) {
  const html = renderToStaticMarkup(<>{await resolve(await page)}</>);
  const body = document.createElement("div");
  body.innerHTML = html;
  return { body, text: body.textContent ?? "", ...within(body) };
}

/** Page props as Next passes them (both are promises in this Next version). */
export function pageProps<P extends Record<string, string>>(params: P = {} as P, searchParams: Record<string, string> = {}) {
  return { params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) } as never;
}
