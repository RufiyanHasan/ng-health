import type * as NgCompiler from '@angular/compiler';

export interface TemplateCall {
  name: string;
  line: number;
  argCount: number;
}

export interface LegacyDirective {
  directive: 'ngIf' | 'ngFor' | 'ngSwitch';
  line: number;
}

export interface TemplateAnalysis {
  calls: TemplateCall[];
  legacy: LegacyDirective[];
  errors: string[];
}

type Compiler = typeof NgCompiler;

let compilerPromise: Promise<Compiler> | undefined;
/** Lazy: @angular/compiler is large and only needed when Angular checks run. */
export const loadCompiler = () => (compilerPromise ??= import('@angular/compiler'));

const LEGACY_ATTRS: Record<string, LegacyDirective['directive']> = {
  ngIf: 'ngIf',
  ngForOf: 'ngFor',
  // ngSwitchCase/ngSwitchDefault belong to the ngSwitch usage and are not counted separately.
  ngSwitch: 'ngSwitch',
};

/**
 * Parses an Angular template and reports implicit-receiver calls in bindings
 * (`{{ total() }}`, `[x]="fmt(a)"`) and legacy structural directives.
 * Event handlers and `@for` track expressions are not bindings and are ignored.
 * `lineOffset` is the 1-based line of the template's first character in its file.
 */
export function analyzeTemplate(
  ng: Compiler,
  text: string,
  url: string,
  lineOffset = 1,
): TemplateAnalysis {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lineOffset + lo;
  };

  const parsed = ng.parseTemplate(text, url, { preserveWhitespaces: false });
  const result: TemplateAnalysis = {
    calls: [],
    legacy: [],
    errors: (parsed.errors ?? []).map((e) => e.toString()),
  };

  class ExpressionVisitor extends ng.RecursiveAstVisitor {
    override visitCall(ast: NgCompiler.Call, context: unknown) {
      const receiver = ast.receiver;
      if (
        receiver instanceof ng.PropertyRead &&
        receiver.receiver instanceof ng.ImplicitReceiver &&
        receiver.name !== '$any'
      ) {
        result.calls.push({
          name: receiver.name,
          line: lineAt(ast.sourceSpan.start),
          argCount: ast.args.length,
        });
      }
      super.visitCall(ast, context);
    }
  }
  const expr = new ExpressionVisitor();
  const visitExpr = (ast: NgCompiler.AST | null | undefined) => {
    if (!ast) return;
    (ast instanceof ng.ASTWithSource ? ast.ast : ast).visit(expr);
  };
  const legacy = (name: string, offset: number) => {
    const directive = LEGACY_ATTRS[name];
    if (directive) result.legacy.push({ directive, line: lineAt(offset) });
  };

  class TemplateVisitor extends ng.TmplAstRecursiveVisitor {
    override visitElement(el: NgCompiler.TmplAstElement) {
      for (const input of el.inputs) legacy(input.name, input.sourceSpan.start.offset);
      super.visitElement(el);
    }
    override visitTemplate(t: NgCompiler.TmplAstTemplate) {
      // `*ngIf="x"` lives in templateAttrs, `<ng-template [ngIf]>` in inputs.
      for (const attr of [...t.templateAttrs, ...t.inputs]) {
        legacy(attr.name, attr.sourceSpan.start.offset);
        if (attr instanceof ng.TmplAstBoundAttribute) visitExpr(attr.value);
      }
      super.visitTemplate(t);
    }
    override visitBoundAttribute(attr: NgCompiler.TmplAstBoundAttribute) {
      visitExpr(attr.value);
    }
    override visitBoundText(text: NgCompiler.TmplAstBoundText) {
      visitExpr(text.value);
    }
    override visitIfBlockBranch(branch: NgCompiler.TmplAstIfBlockBranch) {
      visitExpr(branch.expression);
      super.visitIfBlockBranch(branch);
    }
    override visitForLoopBlock(block: NgCompiler.TmplAstForLoopBlock) {
      visitExpr(block.expression);
      super.visitForLoopBlock(block);
    }
    override visitSwitchBlock(block: NgCompiler.TmplAstSwitchBlock) {
      visitExpr(block.expression);
      super.visitSwitchBlock(block);
    }
    override visitLetDeclaration(decl: NgCompiler.TmplAstLetDeclaration) {
      visitExpr(decl.value);
    }
  }
  // visitTemplate handles its own inputs; avoid double-counting via visitBoundAttribute.
  const visitor = new TemplateVisitor();
  ng.tmplAstVisitAll(visitor, parsed.nodes);
  dedupe(result);
  return result;
}

function dedupe(result: TemplateAnalysis) {
  const seen = new Set<string>();
  result.calls = result.calls.filter((c) => {
    const key = `${c.name}:${c.line}:${c.argCount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seenLegacy = new Set<string>();
  result.legacy = result.legacy.filter((l) => {
    const key = `${l.directive}:${l.line}`;
    if (seenLegacy.has(key)) return false;
    seenLegacy.add(key);
    return true;
  });
}
