"use client";

import { useState } from "react";
import { useManifest } from "../config-context";
import { cx } from "../cx";
import type { Token, TokenGroup } from "../manifest.types";

/**
 * Elementos — the palette, read out of the theme stylesheet at scan time.
 *
 * Parsed by the scanner rather than by fetching the CSS at request time, which
 * is what lets this tier work on a serverless preview deploy with no file
 * tracing configured.
 *
 * Both columns are shown at once because that is the question people actually
 * have: not "what is this colour" but "do the two themes agree". A token that
 * exists in one and not the other is the bug, and it is visible here as a gap.
 */
function Swatch({ value }: { value: string | null }) {
	if (!value) {
		return (
			<span
				className="inline-block h-6 w-10 rounded border border-dashed border-zinc-300 dark:border-zinc-600"
				title="Sin declarar en este tema"
			/>
		);
	}
	return (
		<span
			className="inline-block h-6 w-10 rounded border border-zinc-300 dark:border-zinc-600"
			style={{ background: value }}
			title={value}
		/>
	);
}

function TokenRow({ token }: { token: Token }) {
	const missing = token.light === null || token.dark === null;
	return (
		<tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
			<td className="py-1.5 pr-4 align-middle">
				<code className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{token.name}</code>
				{missing && (
					<span
						className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
						title="Declarado en un solo tema"
					>
						falta un tema
					</span>
				)}
				{token.note && (
					<p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{token.note}</p>
				)}
			</td>
			{token.kind === "color" ? (
				<>
					<td className="py-1.5 pr-3">
						<Swatch value={token.light} />
					</td>
					<td className="py-1.5 pr-3">
						<Swatch value={token.dark} />
					</td>
				</>
			) : (
				<td colSpan={2} className="py-1.5 pr-3">
					<code className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
						{token.light ?? token.dark}
					</code>
				</td>
			)}
		</tr>
	);
}

function Group({ group }: { group: TokenGroup }) {
	return (
		<section id={`token-${group.id}`} className="mb-8">
			<h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
				{group.label}
				<span className="ml-2 text-[11px] font-normal text-zinc-400">{group.tokens.length}</span>
			</h3>
			<table className="w-full max-w-3xl border-collapse text-left">
				<thead>
					<tr className="text-[10px] uppercase tracking-wider text-zinc-400">
						<th className="pb-1 font-medium">Token</th>
						<th className="pb-1 font-medium">Claro</th>
						<th className="pb-1 font-medium">Oscuro</th>
					</tr>
				</thead>
				<tbody>
					{group.tokens.map((token) => (
						<TokenRow key={token.name} token={token} />
					))}
				</tbody>
			</table>
		</section>
	);
}

export function ElementsPanel() {
	const { tokens, config, stats } = useManifest();
	const [filter, setFilter] = useState("");

	const needle = filter.trim().toLowerCase();
	const groups = needle
		? tokens
				.map((group) => ({
					...group,
					tokens: group.tokens.filter((token) => token.name.toLowerCase().includes(needle)),
				}))
				.filter((group) => group.tokens.length > 0)
		: tokens;

	const total = groups.reduce((count, group) => count + group.tokens.length, 0);

	return (
		<div className="flex h-full flex-col">
			<div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-6 py-2 dark:border-zinc-700 dark:bg-zinc-900">
				<input
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					placeholder="Filtrar tokens…"
					className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-[12px] text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
				/>
				<span className="text-[11px] text-zinc-500 dark:text-zinc-400">
					{total} tokens · {config.title}
				</span>
			</div>

			<div className={cx("min-h-0 flex-1 overflow-auto bg-zinc-50 p-6 dark:bg-zinc-950")}>
				{tokens.length === 0 ? (
					// The concrete miss when the scan recorded one — "the file was
					// not there" is a better lead than "check your config".
					stats.missingStylesheet ? (
						<p className="max-w-lg text-sm text-zinc-600 dark:text-zinc-400">
							El escaneo no encontró la hoja de estilos{" "}
							<code className="font-mono">{stats.missingStylesheet}</code>, así que no hay tokens
							que mostrar. Apunta <code>themeSource</code> en
							<code className="mx-1 font-mono">workbench.config.json</code> al archivo con el bloque{" "}
							<code>@theme</code> o <code>:root</code>.
						</p>
					) : (
						<p className="max-w-lg text-sm text-zinc-600 dark:text-zinc-400">
							No se encontró ningún token. Revisa <code>themeSource</code> en
							<code className="mx-1 font-mono">workbench.config.json</code>: debe apuntar a la hoja
							de estilos con el bloque <code>@theme</code> o <code>:root</code>.
						</p>
					)
				) : (
					groups.map((group) => <Group key={group.id} group={group} />)
				)}
			</div>
		</div>
	);
}
