// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { serializeMirror, whenQuiet } from "./mirror";

function documentFrom(html: string): Document {
	const doc = document.implementation.createHTMLDocument();
	doc.documentElement.innerHTML = html;
	return doc;
}

describe("serializeMirror", () => {
	it("strips scripts noscript and inline handlers so the app never boots twice", () => {
		const doc = documentFrom(
			`<head><script src="/main.js"></script></head>` +
				`<body onload="boot()"><noscript>sin JS</noscript>` +
				`<button onclick="fire()">Enviar</button></body>`,
		);
		const html = serializeMirror(doc, "/registro", "http://localhost:3100");

		expect(html).not.toContain("<script");
		expect(html).not.toContain("<noscript");
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("onload");
		expect(html).toContain("Enviar");
	});

	it("injects the route as base so relative assets resolve like the real page", () => {
		const doc = documentFrom(`<head><title>x</title></head><body></body>`);
		const html = serializeMirror(doc, "/onboarding/persona", "http://localhost:3100");

		expect(html).toContain(`<base href="http://localhost:3100/onboarding/persona">`);
		// First in head: a stylesheet before the base would resolve wrong.
		expect(html.indexOf("<base")).toBeLessThan(html.indexOf("<title"));
	});

	it("replaces the page's own base instead of stacking a second one", () => {
		const doc = documentFrom(`<head><base href="/otra/"></head><body></body>`);
		const html = serializeMirror(doc, "/registro", "http://localhost:3100");

		expect(html.match(/<base /g)).toHaveLength(1);
		expect(html).toContain("http://localhost:3100/registro");
	});

	it("keeps the doctype so the mirror renders in standards mode", () => {
		const html = serializeMirror(document, "/", "http://localhost:3100");
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
	});
});

describe("whenQuiet", () => {
	it("a document that stopped mutating is quiet", async () => {
		const doc = documentFrom(`<body></body>`);
		await expect(whenQuiet(doc, 10, 200)).resolves.toBe("quiet");
	});

	it("a document that never stops mutating is restless", async () => {
		const doc = documentFrom(`<body><p id="tick">0</p></body>`);
		const tick = setInterval(() => {
			const node = doc.getElementById("tick");
			if (node) node.textContent = String(Number(node.textContent) + 1);
		}, 5);
		try {
			await expect(whenQuiet(doc, 50, 120)).resolves.toBe("restless");
		} finally {
			clearInterval(tick);
		}
	});
});
