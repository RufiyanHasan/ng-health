import angularAnyUsage from './angular/any-usage.js';
import angularControlFlow from './angular/control-flow.js';
import angularInjectFunction from './angular/inject-function.js';
import angularLargeComponents from './angular/large-components.js';
import angularOnPush from './angular/onpush.js';
import angularStandalone from './angular/standalone.js';
import angularSubscriptions from './angular/subscriptions.js';
import angularTemplateCalls from './angular/template-calls.js';
import bundleSize from './bundle/size.js';
import dependenciesAngularVersion from './dependencies/angular-version.js';
import dependenciesDeprecated from './dependencies/deprecated.js';
import dependenciesOutdated from './dependencies/outdated.js';
import dependenciesVulnerabilities from './dependencies/vulnerabilities.js';
import hygieneCoverage from './hygiene/coverage.js';
import hygieneTests from './hygiene/tests.js';
import hygieneTooling from './hygiene/tooling.js';
import hygieneTypescriptStrict from './hygiene/typescript-strict.js';
import type { Check } from '../core/types.js';

/** Built-in checks. Each lives in its own module under src/checks/<category>/. */
export const builtinChecks: Check[] = [
  dependenciesAngularVersion,
  dependenciesOutdated,
  dependenciesVulnerabilities,
  dependenciesDeprecated,
  bundleSize,
  angularOnPush,
  angularTemplateCalls,
  angularSubscriptions,
  angularControlFlow,
  angularStandalone,
  angularInjectFunction,
  angularAnyUsage,
  angularLargeComponents,
  hygieneTooling,
  hygieneTypescriptStrict,
  hygieneTests,
  hygieneCoverage,
];
