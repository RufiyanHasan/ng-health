import path from 'node:path';
import type * as TsMorph from 'ts-morph';
import type { CheckContext } from '../../core/types.js';
import { analyzeTemplate, loadCompiler, type TemplateAnalysis } from './template.js';

export type AngularKind = 'component' | 'directive' | 'pipe' | 'injectable' | 'ngmodule';

export interface AngularClass {
  name: string;
  kind: AngularKind;
  /** Project-relative POSIX path. */
  file: string;
  line: number;
  /** Constructor parameters (Angular DI injects all of them). */
  constructorParams: number;
  injectCalls: number;
}

export interface ComponentInfo extends AngularClass {
  kind: 'component';
  /** Explicit strategy (`OnPush`, `Eager`, `Default`), undefined when not set. */
  changeDetection: string | undefined;
  /** Explicit `standalone` flag, undefined when not set. */
  standalone: boolean | undefined;
  /** Non-blank lines of the component's TypeScript class. */
  loc: number;
  template:
    | { file: string; inline: boolean; lineOffset: number; analysis: TemplateAnalysis; loc: number }
    | undefined;
  /** Class members that are signals (zero-arg calls to them in templates are fine). */
  signalMembers: string[];
  /** Methods and function-valued properties. */
  methodMembers: string[];
}

export interface SubscribeCall {
  file: string;
  line: number;
  className: string;
  cleanedUp: boolean;
  /** Why it is considered safe, or why not. */
  reason: string;
}

export interface AnyUsage {
  file: string;
  count: number;
  lines: number[];
}

export interface AngularAnalysis {
  sourceFiles: string[];
  classes: AngularClass[];
  components: ComponentInfo[];
  subscribes: SubscribeCall[];
  anyUsage: AnyUsage[];
  totalLoc: number;
  ngModules: number;
  parseErrors: { file: string; message: string }[];
}

const DECORATOR_KINDS: Record<string, AngularKind> = {
  Component: 'component',
  Directive: 'directive',
  Pipe: 'pipe',
  Injectable: 'injectable',
  NgModule: 'ngmodule',
};

const SIGNAL_FACTORIES =
  /^(signal|computed|linkedSignal|input|input\.required|model|model\.required|toSignal|viewChild|viewChild\.required|viewChildren|contentChild|contentChild\.required|contentChildren|resource|rxResource|httpResource|injectQuery|.*Store)$/;

/** Operators/helpers that complete or tear down a subscription. */
const CLEANUP_OPERATORS = /^(takeUntilDestroyed|takeUntil|take|first|takeWhile|untilDestroyed)$/;

export const nonBlankLines = (text: string) =>
  text.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).length;

const toPosix = (p: string) => p.split(path.sep).join('/');

/** Directories holding the project's sources: every angular.json project's sourceRoot, else src/. */
export function sourceRoots(ctx: CheckContext): string[] {
  const roots = ctx.project.projects.map((p) => p.sourceRoot).filter(Boolean);
  return roots.length ? [...new Set(roots)] : ['src'];
}

export async function listSourceFiles(ctx: CheckContext): Promise<string[]> {
  const patterns = sourceRoots(ctx).map((r) => `${r.replace(/\/$/, '')}/**/*.ts`);
  const files = await ctx.glob(patterns);
  return files.filter(
    (f) => !/\.(spec|test|stories|cy)\.ts$|\.d\.ts$|(^|\/)(test|test-setup)\.ts$/.test(f),
  );
}

/** The shared analysis, computed once per audit and reused by every angular/* check. */
export function getAngularAnalysis(ctx: CheckContext): Promise<AngularAnalysis> {
  return ctx.shared('angular-analysis', () => analyze(ctx));
}

async function analyze(ctx: CheckContext): Promise<AngularAnalysis> {
  const [{ Project, SyntaxKind, Node }, ng] = await Promise.all([
    import('ts-morph'),
    loadCompiler(),
  ]);
  const files = await listSourceFiles(ctx);
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { experimentalDecorators: true },
  });

  const result: AngularAnalysis = {
    sourceFiles: files,
    classes: [],
    components: [],
    subscribes: [],
    anyUsage: [],
    totalLoc: 0,
    ngModules: 0,
    parseErrors: [],
  };

  for (const file of files) {
    const text = await ctx.readText(file);
    result.totalLoc += nonBlankLines(text);
    const sf = project.createSourceFile(`/${file}`, text, { overwrite: true });

    const anyNodes = sf.getDescendantsOfKind(SyntaxKind.AnyKeyword);
    if (anyNodes.length) {
      result.anyUsage.push({
        file,
        count: anyNodes.length,
        lines: [...new Set(anyNodes.map((n) => n.getStartLineNumber()))],
      });
    }

    for (const cls of sf.getClasses()) {
      const decorator = cls.getDecorators().find((d) => d.getName() in DECORATOR_KINDS);
      if (!decorator) continue;
      const kind = DECORATOR_KINDS[decorator.getName()] as AngularKind;
      const name = cls.getName() ?? '(anonymous)';
      const injectCalls = cls
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => c.getExpression().getText() === 'inject').length;
      const info: AngularClass = {
        name,
        kind,
        file,
        line: cls.getStartLineNumber(),
        constructorParams: cls.getConstructors()[0]?.getParameters().length ?? 0,
        injectCalls,
      };
      if (kind === 'ngmodule') result.ngModules++;
      result.classes.push(info);

      if (kind === 'component' || kind === 'directive') {
        result.subscribes.push(...findSubscribes(cls, file, name, SyntaxKind, Node));
      }
      if (kind !== 'component') continue;

      const arg = decorator.getArguments()[0];
      const meta = arg && Node.isObjectLiteralExpression(arg) ? arg : undefined;
      const prop = (key: string) => {
        const p = meta?.getProperty(key);
        return p && Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
      };
      const standaloneInit = prop('standalone')?.getText();

      const signalMembers: string[] = [];
      const methodMembers = cls.getMethods().map((m) => m.getName());
      for (const p of cls.getProperties()) {
        const init = p.getInitializer();
        if (
          init &&
          Node.isCallExpression(init) &&
          SIGNAL_FACTORIES.test(init.getExpression().getText())
        ) {
          signalMembers.push(p.getName());
        } else if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          methodMembers.push(p.getName());
        }
      }

      let template: ComponentInfo['template'];
      const inline = prop('template');
      const templateUrl = prop('templateUrl');
      try {
        if (
          inline &&
          (Node.isNoSubstitutionTemplateLiteral(inline) || Node.isStringLiteral(inline))
        ) {
          const tplText = inline.getLiteralText();
          template = {
            file,
            inline: true,
            lineOffset: inline.getStartLineNumber(),
            analysis: analyzeTemplate(ng, tplText, file, inline.getStartLineNumber()),
            loc: nonBlankLines(tplText),
          };
        } else if (templateUrl && Node.isStringLiteral(templateUrl)) {
          const tplFile = toPosix(
            path.posix.join(path.posix.dirname(file), templateUrl.getLiteralText()),
          );
          const tplText = await ctx.readText(tplFile);
          template = {
            file: tplFile,
            inline: false,
            lineOffset: 1,
            analysis: analyzeTemplate(ng, tplText, tplFile),
            loc: nonBlankLines(tplText),
          };
        }
      } catch (err) {
        result.parseErrors.push({ file, message: `Template could not be read: ${String(err)}` });
      }
      for (const e of template?.analysis.errors ?? [])
        result.parseErrors.push({ file: template?.file ?? file, message: e });

      result.components.push({
        ...info,
        kind: 'component',
        changeDetection: /ChangeDetectionStrategy\.(\w+)$/.exec(
          prop('changeDetection')?.getText() ?? '',
        )?.[1],
        standalone:
          standaloneInit === 'true' ? true : standaloneInit === 'false' ? false : undefined,
        loc: nonBlankLines(cls.getText()),
        template,
        signalMembers,
        methodMembers,
      });
    }
  }
  return result;
}

function findSubscribes(
  cls: TsMorph.ClassDeclaration,
  file: string,
  className: string,
  SyntaxKind: typeof TsMorph.SyntaxKind,
  Node: typeof TsMorph.Node,
): SubscribeCall[] {
  const classText = cls.getText();
  const hasDestroyHook =
    /ngOnDestroy\s*\([^)]*\)[^{]*\{[\s\S]*?(unsubscribe|\.next\(|\.complete\()/.test(classText) ||
    /\.onDestroy\(/.test(classText);
  const calls: SubscribeCall[] = [];

  for (const call of cls.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'subscribe') continue;
    const receiver = callee.getExpression();
    const receiverText = receiver.getText();
    const at = { file, line: call.getStartLineNumber(), className };

    // operators used in .pipe(...) on the receiver chain
    const operators = receiver
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .concat(Node.isCallExpression(receiver) ? [receiver] : [])
      .map((c) => c.getExpression().getText().split('.').pop() ?? '');
    const cleanupOp = operators.find((op) => CLEANUP_OPERATORS.test(op));
    if (cleanupOp) {
      calls.push({ ...at, cleanedUp: true, reason: `uses ${cleanupOp}()` });
      continue;
    }
    if (/\bhttp(Client)?\b/i.test(receiverText)) {
      calls.push({ ...at, cleanedUp: true, reason: 'HttpClient observables complete' });
      continue;
    }
    if (
      /\b(activatedRoute|route)\.(params|queryParams|paramMap|queryParamMap|data|fragment|url)\b/.test(
        receiverText,
      )
    ) {
      calls.push({
        ...at,
        cleanedUp: true,
        reason: 'ActivatedRoute observables are completed by the router',
      });
      continue;
    }

    // Stored subscription (`this.sub = x.subscribe()`, `subs.add(...)`) torn down in ngOnDestroy/DestroyRef.
    const parent = call.getParent();
    const stored =
      (parent &&
        (Node.isBinaryExpression(parent) ||
          Node.isVariableDeclaration(parent) ||
          Node.isPropertyDeclaration(parent))) ||
      (parent &&
        Node.isCallExpression(parent) &&
        /\.(add|push)$/.test(parent.getExpression().getText()));
    if (stored && hasDestroyHook) {
      calls.push({ ...at, cleanedUp: true, reason: 'subscription is torn down on destroy' });
      continue;
    }
    calls.push({
      ...at,
      cleanedUp: false,
      reason: stored
        ? 'subscription is stored but never unsubscribed'
        : 'no takeUntilDestroyed/async pipe/DestroyRef cleanup',
    });
  }
  return calls;
}
