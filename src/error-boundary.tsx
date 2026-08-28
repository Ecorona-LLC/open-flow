"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRuntimeError } from "./runtime-errors";

/**
 * Keeps one broken component from taking down the workbench.
 *
 * The shell is a `fixed inset-0` overlay, so an error escaping a preview would
 * blank Elementos and Flujos too — not just the component that threw. This
 * catches it, names the file to open, and leaves the rest of the tool usable.
 *
 * It matters more now than it did: the spider renders components nobody
 * hand-picked, some with invented props, so a component that throws on a
 * synthesized value is an ordinary event rather than an exceptional one.
 *
 * A class component because React error boundaries have no hook equivalent.
 */
interface Props {
	/** Remount key handled by the caller; shown so you know what to open. */
	label: string;
	/** Component id, recorded with the error so a ticket can name it. */
	component?: string;
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export class PreviewErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(`[workbench] el componente lanzó: ${this.props.label}`, error, info);
		// Catching it is half the job; a ticket wants to say *where*. The label
		// is the component's source path, which is exactly the answer.
		reportRuntimeError({
			message: error.message,
			component: this.props.component ?? null,
			file: this.props.label,
			route: null,
		});
	}

	componentDidUpdate(previous: Props) {
		// Selecting a different component clears the previous one's error.
		if (previous.label !== this.props.label && this.state.error) {
			this.setState({ error: null });
		}
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
				<p className="font-semibold text-red-800 dark:text-red-200">
					Este componente lanzó un error
				</p>
				<p className="mt-1 font-mono text-[11px] text-red-700 dark:text-red-300">
					{this.props.label}
				</p>
				<pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-900 dark:text-red-200">
					{error.message}
				</pre>
				<p className="mt-3 text-[11px] text-red-700 dark:text-red-300">
					Si el taller inventó los props, es probable que falte una demo — el panel lo dice. Arregla
					el archivo y vuelve a seleccionarlo; no hace falta recargar.
				</p>
			</div>
		);
	}
}
