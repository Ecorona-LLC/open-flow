import { describe, expect, it, vi } from "vitest";
import type { RuntimeError } from "./pin";

// The module keeps its entries in module state; a fresh import per test is
// what keeps these order-independent.
async function freshModule() {
	vi.resetModules();
	return import("./runtime-errors");
}

function error(message: string): RuntimeError {
	return { message, route: "/panel", component: null, file: null, at: "12:00" };
}

describe("runtime errors", () => {
	it("notifies subscribers with the newest error first", async () => {
		const { reportRuntimeError, subscribeRuntimeErrors } = await freshModule();
		const seen: RuntimeError[][] = [];
		subscribeRuntimeErrors((entries) => seen.push(entries));
		reportRuntimeError(error("primero"));
		reportRuntimeError(error("segundo"));
		expect(seen.at(-1)?.map((entry) => entry.message)).toEqual(["segundo", "primero"]);
	});

	it("drops a consecutive duplicate so a render loop cannot flood the list", async () => {
		const { reportRuntimeError, subscribeRuntimeErrors } = await freshModule();
		let latest: RuntimeError[] = [];
		subscribeRuntimeErrors((entries) => {
			latest = entries;
		});
		reportRuntimeError(error("igual"));
		reportRuntimeError(error("igual"));
		expect(latest).toHaveLength(1);
	});

	it("caps the list at its maximum", async () => {
		const { reportRuntimeError, subscribeRuntimeErrors } = await freshModule();
		let latest: RuntimeError[] = [];
		subscribeRuntimeErrors((entries) => {
			latest = entries;
		});
		for (let index = 0; index < 30; index++) {
			reportRuntimeError(error(`e${index}`));
		}
		expect(latest.length).toBeLessThanOrEqual(20);
	});

	it("unsubscribing stops the notifications", async () => {
		const { reportRuntimeError, subscribeRuntimeErrors } = await freshModule();
		let calls = 0;
		const unsubscribe = subscribeRuntimeErrors(() => {
			calls += 1;
		});
		unsubscribe();
		reportRuntimeError(error("después"));
		expect(calls).toBe(0);
	});
});
