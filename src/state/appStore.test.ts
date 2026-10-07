import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';
import { antipodeOf } from '../features/globe/geo';
import { useAppStore } from './appStore';

const origin = { latitude: 35.6762, longitude: 139.6503 };
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('store dependency boundary', () => {
  it('has no Three import in its transitive source dependency graph', () => {
    const pending = [resolve(sourceRoot, 'state/appStore.ts')];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      const imports = sourceImports(file, source);
      expect(imports, file).not.toContainEqual(
        expect.stringMatching(/^three(?:\/|$)/),
      );

      for (const importPath of imports.filter((path) => path.startsWith('.'))) {
        const dependency = resolveSourceImport(file, importPath);
        if (dependency) pending.push(dependency);
      }
    }
  });

  it('recognizes every supported source import form', () => {
    const imports = sourceImports(
      'fixture.ts',
      [
        "import './side-effect';",
        "import value from './value.ts';",
        "export { value } from './barrel/index.tsx';",
        "void import('./dynamic');",
        "import 'three/addons';",
      ].join('\n'),
    );

    expect(imports).toEqual([
      './side-effect',
      './value.ts',
      './barrel/index.tsx',
      './dynamic',
      'three/addons',
    ]);
  });
});

function sourceImports(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function resolveSourceImport(
  importer: string,
  importPath: string,
): string | null {
  const absolute = resolve(dirname(importer), importPath);
  if (/\.[^.]+$/.test(importPath) && !/\.tsx?$/.test(importPath)) return null;
  const candidates = /\.tsx?$/.test(importPath)
    ? [absolute]
    : [
        `${absolute}.ts`,
        `${absolute}.tsx`,
        resolve(absolute, 'index.ts'),
        resolve(absolute, 'index.tsx'),
      ];
  const match = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!match) throw new Error(`Cannot resolve ${importPath} from ${importer}`);
  if (!match.startsWith(`${sourceRoot}/`)) {
    throw new Error(`Relative import escapes app source: ${match}`);
  }
  return match;
}

describe('camera focus intent', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeMode: 'antipodes',
      point: origin,
      cameraFocusIntent: { side: 'origin', target: null },
    });
  });

  it('toggles from origin or free to the antipode and back to the exact origin', () => {
    const { toggleAntipodeFocus, setCameraFocusFree } = useAppStore.getState();

    toggleAntipodeFocus();
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'antipode',
      target: antipodeOf(origin),
    });

    toggleAntipodeFocus();
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'origin',
      target: origin,
    });

    setCameraFocusFree();
    toggleAntipodeFocus();
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'antipode',
      target: antipodeOf(origin),
    });
  });

  it('resets the semantic side when a new point is selected', () => {
    useAppStore.getState().toggleAntipodeFocus();

    const next = { latitude: -33.8688, longitude: 151.2093 };
    useAppStore.getState().selectPoint(next);

    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'origin',
      target: next,
    });
  });

  it('distinguishes manual movement from major-city focus', () => {
    useAppStore.getState().toggleAntipodeFocus();
    useAppStore.getState().setCameraFocusFree();
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'free',
      target: null,
    });

    const place = { latitude: -31.6333, longitude: -60.7 };
    useAppStore.getState().requestCameraFocus(place);
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'major-city',
      target: place,
    });
    expect(useAppStore.getState().point).toEqual(origin);
  });

  it('clears stale semantic sides on mode changes', () => {
    useAppStore.getState().toggleAntipodeFocus();
    useAppStore.getState().selectMode('sunline');
    useAppStore.getState().selectMode('antipodes');

    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'free',
      target: null,
    });
  });

  it('does not clear a newer camera target when an older animation completes', () => {
    const store = useAppStore.getState();
    store.toggleAntipodeFocus();
    const olderTarget = useAppStore.getState().cameraFocusIntent.target!;
    store.toggleAntipodeFocus();
    const newerIntent = useAppStore.getState().cameraFocusIntent;

    useAppStore.getState().clearCameraTarget(olderTarget);

    expect(useAppStore.getState().cameraFocusIntent).toEqual(newerIntent);
  });
});

describe('shell mode state', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeMode: null,
      point: origin,
      cameraFocusIntent: { side: 'free', target: null },
      sunlinePlaying: false,
      hoveredCountry: null,
    });
  });

  it('selectMode stops Sunline playback', () => {
    useAppStore.setState({ sunlinePlaying: true });
    useAppStore.getState().selectMode('sunline');

    expect(useAppStore.getState().activeMode).toBe('sunline');
    expect(useAppStore.getState().sunlinePlaying).toBe(false);
  });

  it('exitMode returns to the lobby and preserves point and camera intent', () => {
    useAppStore.setState({
      activeMode: 'antipodes',
      point: origin,
      cameraFocusIntent: { side: 'origin', target: origin },
      sunlinePlaying: true,
      hoveredCountry: { countryId: 'cn', name: 'China' },
    });
    useAppStore.getState().exitMode();

    expect(useAppStore.getState().activeMode).toBeNull();
    expect(useAppStore.getState().sunlinePlaying).toBe(false);
    expect(useAppStore.getState().hoveredCountry).toBeNull();
    expect(useAppStore.getState().point).toEqual(origin);
    expect(useAppStore.getState().cameraFocusIntent).toEqual({
      side: 'origin',
      target: origin,
    });
  });
});
