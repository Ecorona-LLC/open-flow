"use client";

import { Fragment, Suspense, type ReactNode } from "react";
import { cx } from "./cx";
import { PreviewErrorBoundary } from "./error-boundary";
import type { ComponentEntry, Renderability } from "./manifest.types";
import { sampleProps, useComponentModule, type RegistryEntry } from "./registry";

/**
 * One component, rendered the most honest way available.
 *
 * The verdict badge is not decoration. A `synthesized` render used invented
 * props, and someone screenshotting it as "how the component looks" would be
 * wrong in a way they could not see. Saying so costs one line.
 */
const VERDICTS: Record<Renderability, { label: string; hint: string; tone: string }> = {
	demo: {
		label: "demo",
		hint: "Escrita a mano, junto al componente.",
		tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
	},
	auto: {
		label: "automático",
		hint: "No necesita props: esto es el componente tal cual.",
		tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
	},
	synthesized: {
		label: "props inventados",
		hint: "El taller rellenó los props obligatorios. Sirve para ver la forma, no para juzgar el contenido.",
		tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
	},
	"needs-demo": {
		label: "necesita demo",
		hint: "Sus props obligatorios no se pueden inventar — una función, un objeto o un tipo importado.",
		tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
	},
	server: {
		label: "componente de servidor",
		hint: "No existe en el grafo del cliente. Míralo en un flujo, que renderiza la página real.",
		tone: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
	},
};

export function VerdictBadge({ verdict }: { verdict: Renderability }) {
	const meta = VERDICTS[verdict];
	return (
		<span
			title={meta.hint}
			className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", meta.tone)}
		>
			{meta.label}
		</span>
	);
}

/** What to say when there is nothing to render, and what to do about it. */
function CannotRender({ entry }: { entry: ComponentEntry }) {
	const meta = VERDICTS[entry.verdict];
	const required = entry.props.filter((prop) => prop.required && !prop.sample);

	return (
		<div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700">
			<p className="font-medium text-zinc-700 dark:text-zinc-200">{meta.hint}</p>
			{required.length > 0 && (
				<>
					<p className="mt-3 text-[11px] uppercase tracking-wider text-zinc-400">
						Props que no se pudieron inventar
					</p>
					<ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
						{required.map((prop) => (
							<li key={prop.name}>
								{prop.name}: {prop.typeText || "?"}
							</li>
						))}
					</ul>
				</>
			)}
			{entry.verdict === "needs-demo" && (
				<p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
					Crea <code className="font-mono">{entry.file.replace(/\.tsx$/, ".demo.tsx")}</code> y el
					taller lo usará en lugar de esto.
				</p>
			)}
		</div>
	);
}

function Rendered({
	entry,
	registry,
	overrides,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry;
	/** Pin one prop, so a variant row can show the same component per value. */
	overrides?: Record<string, string>;
}) {
	const loaded = useComponentModule(registry);

	if (loaded.error) {
		return (
			<p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
				{loaded.error}
			</p>
		);
	}

	// A hand-written demo always wins over anything the spider inferred.
	if (loaded.demo) {
		return <>{loaded.demo.render()}</>;
	}

	const { Component } = loaded;
	if (!Component) return <CannotRender entry={entry} />;

	const { props, children } = sampleProps(entry.props);
	return (
		<Component {...props} {...overrides}>
			{children}
		</Component>
	);
}

/**
 * The headline render of one component, inside its own error boundary.
 *
 * The boundary matters more here than it did when every preview was
 * hand-written: the spider renders components nobody vetted, some with invented
 * props, so one throwing is ordinary rather than exceptional — and it must not
 * take the tool down with it.
 */
export function ComponentPreview({
	entry,
	registry,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry | undefined;
}) {
	if (!registry || entry.verdict === "server" || entry.verdict === "needs-demo") {
		return <CannotRender entry={entry} />;
	}
	return (
		<PreviewErrorBoundary label={entry.file} component={entry.name}>
			<Suspense fallback={<PreviewSkeleton />}>
				<Rendered entry={entry} registry={registry} />
			</Suspense>
		</PreviewErrorBoundary>
	);
}

/**
 * One named section of a component, isolated: a demo scenario or a variant
 * axis, by name. This is what a device-preset section iframe renders — before
 * it existed, every section's iframe loaded the same URL and showed the main
 * preview, whatever its header claimed.
 *
 * One `scenario` name is unambiguous because demo scenarios and variant rows
 * are mutually exclusive on the panel: `VariantScenarios` yields to a
 * hand-written demo.
 */
export function ScenarioPreview({
	entry,
	registry,
	scenario,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry | undefined;
	scenario: string;
}) {
	if (!registry || entry.verdict === "server" || entry.verdict === "needs-demo") {
		return <CannotRender entry={entry} />;
	}
	return (
		<PreviewErrorBoundary label={`${entry.file} · ${scenario}`} component={entry.name}>
			<Suspense fallback={<PreviewSkeleton />}>
				<NamedScenario entry={entry} registry={registry} scenario={scenario} />
			</Suspense>
		</PreviewErrorBoundary>
	);
}

function NamedScenario({
	entry,
	registry,
	scenario,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry;
	scenario: string;
}) {
	const loaded = useComponentModule(registry);

	const named = loaded.demo?.scenarios?.find((item) => item.name === scenario);
	if (named) return <>{named.render()}</>;

	const axis = entry.variants.find((item) => item.name === scenario);
	if (axis) {
		return (
			<div className="flex flex-wrap items-start gap-4">
				{axis.values.map((value) => (
					<figure key={value} className="flex flex-col items-start gap-1">
						<Rendered entry={entry} registry={registry} overrides={{ [axis.name]: value }} />
						<figcaption className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
							{value}
							{value === axis.default && " ·"}
						</figcaption>
					</figure>
				))}
			</div>
		);
	}

	// An unknown name — a renamed axis, a stale link — falls back to the main
	// render rather than a blank frame.
	return <Rendered entry={entry} registry={registry} />;
}

/**
 * One render per declared variant value.
 *
 * This is what the old workbench needed a hand-written
 * `scenario("Variantes", …)` for, in every primitive, forever. The `cva` call
 * already names every value and which one is the default, so the row can be
 * built from the component's own source instead of from a parallel list
 * somebody has to remember to update when they add a variant.
 */
export function VariantScenarios({
	entry,
	registry,
	render,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry | undefined;
	render: (name: string, description: string | undefined, node: ReactNode) => ReactNode;
}) {
	// A hand-written demo owns its own scenarios; two competing variant rows on
	// one page is worse than either alone.
	if (!registry || registry.demo || entry.variants.length === 0) return null;
	if (entry.verdict === "server" || entry.verdict === "needs-demo") return null;

	return (
		<>
			{entry.variants.map((axis) => (
				<Fragment key={axis.name}>
					{render(
						axis.name,
						axis.default
							? `${axis.values.length} valores · por defecto ${axis.default}`
							: `${axis.values.length} valores`,
						<div className="flex flex-wrap items-start gap-4">
							{axis.values.map((value) => (
								<figure key={value} className="flex flex-col items-start gap-1">
									<PreviewErrorBoundary label={entry.file} component={entry.name}>
										<Suspense fallback={<PreviewSkeleton />}>
											<Rendered
												entry={entry}
												registry={registry}
												overrides={{ [axis.name]: value }}
											/>
										</Suspense>
									</PreviewErrorBoundary>
									<figcaption className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
										{value}
										{value === axis.default && " ·"}
									</figcaption>
								</figure>
							))}
						</div>,
					)}
				</Fragment>
			))}
		</>
	);
}

/** Named scenarios from a hand-written demo, when there are any. */
export function ComponentScenarios({
	entry,
	registry,
	render,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry | undefined;
	render: (name: string, description: string | undefined, node: ReactNode) => ReactNode;
}) {
	if (!registry?.demo) return null;
	return (
		<Suspense fallback={null}>
			<Scenarios entry={entry} registry={registry} render={render} />
		</Suspense>
	);
}

function Scenarios({
	entry,
	registry,
	render,
}: {
	entry: ComponentEntry;
	registry: RegistryEntry;
	render: (name: string, description: string | undefined, node: ReactNode) => ReactNode;
}) {
	const loaded = useComponentModule(registry);
	const scenarios = loaded.demo?.scenarios ?? [];
	if (scenarios.length === 0) return null;

	return (
		<>
			{scenarios.map((scenario) => (
				<PreviewErrorBoundary
					key={scenario.name}
					label={`${entry.file} · ${scenario.name}`}
					component={entry.name}
				>
					{render(scenario.name, scenario.description, scenario.render())}
				</PreviewErrorBoundary>
			))}
		</>
	);
}

function PreviewSkeleton() {
	return <div className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" aria-hidden />;
}
