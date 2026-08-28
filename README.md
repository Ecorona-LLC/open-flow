# open-flow

Un taller vivo sobre la app Next.js que ya tienes — componentes reales, tokens
reales, recorridos reales. Nada es una copia: el visor importa los componentes
de tu propia app, así que la vista previa y el componente publicado no pueden
divergir, porque son el mismo código.

```
pnpm add -D @open-flow/ui
```

Público y sin configuración: cualquier repositorio lo instala sin tokens ni
registros adicionales.

## Las dos mitades

- **`@open-flow/ui`** (este repositorio, código abierto): el visor completo —
  Elementos, Componentes, Flujos con su tablero de espejos, Superficies, el
  overlay ⌥P para señalar sobre páginas reales, y la API de demos.
- **El motor de escaneo** (privado): el analizador que lee tu repositorio y
  produce el mapa que este visor pinta. Se distribuye por separado, con
  autorización de Ecorona LLC.

El visor funciona sobre los artefactos que el motor genera (`.workbench/`);
sin el motor, puedes montar el visor con artefactos ya generados.

## Desarrollo

```
pnpm install
pnpm build        # tsc + minificado
pnpm test         # vitest
pnpm typecheck
```

## Licencia

Elastic License 2.0 — el código es visible y modificable; no puede ofrecerse
como servicio gestionado a terceros ni eludirse la separación con el motor.
Ver [LICENSE](./LICENSE). _(Texto pendiente de revisión legal por Ecorona LLC.)_
