import * as ts from 'typescript/lib/tsserverlibrary'
import {Checker} from './third_party/tsetse/checker';
import { ENABLED_RULES } from './rule_groups';
import { DiagnosticWithFix, Fix } from './third_party/tsetse/failure';

/**
 * The proxy design pattern, allowing us to customize behavior of the delegate
 * object.
 * This creates a property-by-property copy of the object, so it can be mutated
 * without affecting other users of the original object.
 * See https://en.wikipedia.org/wiki/Proxy_pattern
 */
function createProxy<T>(delegate: T): T {
  const proxy = Object.create(null);
  for (const k of Object.keys(delegate)) {
    proxy[k] = function() {
      return (delegate as any)[k].apply(delegate, arguments);
    };
  }
  return proxy;
}


// Installs the Tsec language server plugin, which checks Tsec rules in your
// editor and shows issues as semantic errors (red squiggly underline).
function init() {
  let registeredCodeFixes = false;

  // Work around the lack of API to register a CodeFix
  function registerCodeFix(action: codefix.CodeFix) {
      return (ts as any).codefix.registerCodeFix(action);
  }

  if (!registeredCodeFixes && ts && (ts as any).codefix) {
      registerCodeFixes(registerCodeFix);
      registeredCodeFixes = true;
  }

  function registerCodeFixes(registerCodeFix: (action: codefix.CodeFix) => void) {
      console.log('REGISTERED');
      // Code fix for that is used for all tslint fixes
      registerCodeFix({
          errorCodes: [21228],
          getCodeActions: (_context: any) => {
              return undefined;
          }
      });
  }

  return {
    create(info: ts.server.PluginCreateInfo) {
      const oldService = info.languageService
      const proxy = createProxy(oldService)

      // Note that this ignores suggested fixes. Fixes can be implemented in a separate proxy
      // method. See:
      // https://github.com/angelozerr/tslint-language-service/blob/880486c5f1db7961fb7170a621e25893332b2430/src/index.ts#L415
      proxy.getSemanticDiagnostics = (fileName: string) => {
        const result = [...oldService.getSemanticDiagnostics(fileName)]

        const program = oldService.getProgram()

        // Signature of `getProgram` is `getProgram(): Program | undefined;` in
        // ts 3.1 so we must check if the return value is valid to compile with
        // ts 3.1.
        if (!program) {
          throw new Error(
            'Failed to initialize tsetse language_service_plugin: program is undefined',
          )
        }

        const checker = new Checker(program)

        // Register all of the rules for now.
        // TODO: maybe make this configurable. See:
        // https://github.com/bazelbuild/rules_typescript/blob/master/internal/tsetse/language_service_plugin.ts#L29
        for (const Rule of ENABLED_RULES) {
          new Rule().register(checker);
        }

        result.push(
          ...checker
            .execute(program.getSourceFile(fileName)!)
            .map((failure) => {
              return failure.toDiagnosticWithStringifiedFix()
            }),
        )
        return result
      }

      proxy.getCodeFixesAtPosition = function (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> {
        let prior = oldService.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, userPreferences);
        
        const fixes = prior ? [...prior] : [];

        const checker = new Checker(oldService.getProgram()!)
        // Register all of the rules for now.
        // TODO: maybe make this configurable. See:
        // https://github.com/bazelbuild/rules_typescript/blob/master/internal/tsetse/language_service_plugin.ts#L29
        for (const Rule of ENABLED_RULES) {
          new Rule().register(checker);
        }
        
        const f = checker
          .execute(oldService.getProgram()!.getSourceFile(fileName)!)
        
        f.forEach((failure) => {
            const d = failure.toDiagnostic();
            console.log('aaaaa', fileName, start, end)
            if (d.fix) fixes.push(tsecFixToCodeFix(fileName, d) as ts.CodeFixAction);
          })

        console.log('aaaaa', f.length, fileName, start, end)
        console.log('FFF: ', JSON.stringify(fixes))
        
        return fixes;
      };

      return proxy;
    }
  }
}

const tsecFixToCodeFix = (fileName: string, d: DiagnosticWithFix): ts.CodeAction => {
  return {
    description: `Tsec fix`,
    changes: [{
      fileName: fileName,
      textChanges: [{span: {length: d.length!, start: d.start!}, newText: 'tsec replacement'}],
    }]
  };
}

/* @internal */
// work around for missing API to register a code fix
namespace codefix {

  export interface CodeFix {
      errorCodes: number[];
      getCodeActions(context: any): ts.CodeAction[] | undefined;
  }
}

export = init;
